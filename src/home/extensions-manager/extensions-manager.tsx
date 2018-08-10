import * as React from "react";
import { observable, computed, action, runInAction, autorun } from "mobx";
import { observer } from "mobx-react";
import * as classNames from "classnames";
import { bind } from "bind-decorator";

import { compareVersions } from "shared/util";
import { humanize } from "shared/string";

import { scheduleTask, Priority } from "shared/scheduler";

import { IExtension } from "shared/extensions/extension";
import {
    installedExtensions,
    installExtension,
    uninstallExtension,
    changeExtensionImage,
    exportExtension
} from "shared/extensions/extensions";
import { extensionsCatalog } from "shared/extensions/catalog";

import {
    copyFile,
    getTempFilePath,
    getValidFileNameFromFileName,
    writeBinaryData
} from "shared/util";
import { stringCompare } from "shared/string";

import { Splitter } from "shared/ui/splitter";
import { VerticalHeaderWithBody, Header, ToolbarHeader, Body } from "shared/ui/header-with-body";
import { Toolbar } from "shared/ui/toolbar";
import { ButtonAction } from "shared/ui/action";
import { List, ListItem, IListNode } from "shared/ui/list";
import { confirm, confirmWithButtons, info } from "shared/ui/dialog";
import * as notification from "shared/ui/notification";
import { Loader } from "shared/ui/loader";

import { ExtensionShortcuts } from "home/extensions-manager/extension-shortcuts";

////////////////////////////////////////////////////////////////////////////////

enum ViewFilter {
    ALL,
    INSTALLED,
    NOT_INSTALLED,
    NEW_VERSIONS
}

interface IExtensionVersions {
    allVersions: IExtension[];
    installedVersion?: IExtension;
    latestVersion: IExtension;
    versionInFocus: IExtension; // installed || latest
}

class ExtensionsVersionsCatalogBuilder {
    extensionsVersions: IExtensionVersions[] = [];

    isInstalled(extension: IExtension) {
        return !!extension.installationFolderPath;
    }

    addVersion(extensionVersions: IExtensionVersions, extension: IExtension) {
        for (let i = 0; i < extensionVersions.allVersions.length; ++i) {
            const compareResult = compareVersions(
                extension.version,
                extensionVersions.allVersions[i].version
            );

            if (compareResult > 0) {
                extensionVersions.allVersions.splice(i, 0, extension);
                return;
            }

            if (compareResult === 0) {
                if (this.isInstalled(extension)) {
                    extensionVersions.allVersions[i] = extension;
                }
                return;
            }
        }

        extensionVersions.allVersions.push(extension);
    }

    addExtension(extension: IExtension) {
        for (let i = 0; i < this.extensionsVersions.length; ++i) {
            const extensionVersions = this.extensionsVersions[i];
            if (extensionVersions.versionInFocus.id === extension.id) {
                // a new version of already seen extension
                this.addVersion(extensionVersions, extension);

                if (
                    compareVersions(extension.version, extensionVersions.latestVersion.version) > 0
                ) {
                    extensionVersions.latestVersion = extension;
                }

                if (this.isInstalled(extension)) {
                    extensionVersions.installedVersion = extension;
                }

                extensionVersions.versionInFocus =
                    extensionVersions.installedVersion || extensionVersions.latestVersion;

                return;
            }
        }

        // a new extension
        const extensionVersions: IExtensionVersions = {
            allVersions: [extension],
            latestVersion: extension,
            versionInFocus: extension
        };

        if (this.isInstalled(extension)) {
            extensionVersions.installedVersion = extension;
        }

        this.extensionsVersions.push(extensionVersions);
    }

    get(viewFilter: ViewFilter) {
        if (viewFilter === ViewFilter.ALL) {
            return this.extensionsVersions;
        } else if (viewFilter === ViewFilter.INSTALLED) {
            return this.extensionsVersions.filter(
                extensionVersions => !!extensionVersions.installedVersion
            );
        } else if (viewFilter === ViewFilter.NOT_INSTALLED) {
            return this.extensionsVersions.filter(
                extensionVersions => !extensionVersions.installedVersion
            );
        } else {
            return this.extensionsVersions.filter(
                extensionVersions =>
                    extensionVersions.installedVersion &&
                    compareVersions(
                        extensionVersions.latestVersion.version,
                        extensionVersions.installedVersion.version
                    ) > 0
            );
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

class ExtensionsManagerStore {
    @observable
    selectedExtension: IExtension | undefined;

    @observable
    viewFilter: ViewFilter = ViewFilter.ALL;

    @computed
    get extensionsVersionsCatalogBuilder() {
        const builder = new ExtensionsVersionsCatalogBuilder();
        installedExtensions.get().forEach(extension => builder.addExtension(extension));
        extensionsCatalog.catalog.forEach(extension => builder.addExtension(extension));
        return builder;
    }

    @computed
    get extensionNodes() {
        return this.extensionsVersionsCatalogBuilder
            .get(extensionsManagerStore.viewFilter)
            .sort((a, b) =>
                stringCompare(
                    a.versionInFocus.displayName || a.versionInFocus.name,
                    b.versionInFocus.displayName || b.versionInFocus.name
                )
            )
            .map(extension => ({
                id: extension.versionInFocus.id,
                data: extension.versionInFocus,
                selected:
                    extensionsManagerStore.selectedExtension !== undefined &&
                    extension.versionInFocus.id === extensionsManagerStore.selectedExtension.id
            }));
    }

    @action
    selectExtensionById(id: string) {
        const extensionNode = this.extensionNodes.find(extensionNode => extensionNode.id === id);
        this.selectedExtension = (extensionNode && extensionNode.data) || undefined;
    }

    @computed
    get selectedExtensionVersions() {
        if (!this.selectedExtension) {
            return undefined;
        }
        const selectedExtensionId = this.selectedExtension.id;
        return this.extensionsVersionsCatalogBuilder
            .get(ViewFilter.ALL)
            .find(extensionVersions => extensionVersions.versionInFocus.id === selectedExtensionId);
    }

    getSelectedExtensionByVersion(version: string) {
        return (
            this.selectedExtensionVersions &&
            this.selectedExtensionVersions.allVersions.find(
                extension => extension.version === version
            )
        );
    }
}

const extensionsManagerStore = new ExtensionsManagerStore();

////////////////////////////////////////////////////////////////////////////////

@observer
export class ExtensionInMasterView extends React.Component<
    {
        extension: IExtension;
    },
    {}
> {
    render() {
        return (
            <ListItem
                leftIcon={this.props.extension.image}
                leftIconSize={64}
                label={
                    <div>
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                justifyContent: "space-between"
                            }}
                        >
                            <h5 className="EezStudio_NoWrap" style={{ marginBottom: 0 }}>
                                {this.props.extension.displayName || this.props.extension.name}
                            </h5>
                            <small>{this.props.extension.version}</small>
                        </div>
                        <div>{this.props.extension.description}</div>
                        <div className="EezStudio_NoWrap">
                            <small>{this.props.extension.author}</small>
                        </div>
                    </div>
                }
            />
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

function confirmMessage(extension: IExtension) {
    return `You are about to install version ${extension.version} of the '${extension.displayName ||
        extension.name}' extension.`;
}

const BUTTON_INSTRUCTIONS = `
Click 'OK' to replace the installed version.
Click 'Cancel' to stop the installation.`;

const BUTTONS = ["OK", "Cancel"];

@observer
class MasterView extends React.Component {
    installExtension() {
        EEZStudio.electron.remote.dialog.showOpenDialog(
            {
                properties: ["openFile"],
                filters: [
                    { name: "Extensions", extensions: ["zip"] },
                    { name: "All Files", extensions: ["*"] }
                ]
            },
            async function(filePaths) {
                if (filePaths && filePaths[0]) {
                    try {
                        let filePath = filePaths[0];

                        const extension = await installExtension(filePath, {
                            notFound() {
                                info("This is not a valid extension package file.", undefined);
                            },
                            async confirmReplaceNewerVersion(
                                newExtension: IExtension,
                                existingExtension: IExtension
                            ) {
                                return (
                                    (await confirmWithButtons(
                                        confirmMessage(newExtension),
                                        `The newer version ${
                                            existingExtension.version
                                        } is already installed.${BUTTON_INSTRUCTIONS}`,
                                        BUTTONS
                                    )) === 0
                                );
                            },
                            async confirmReplaceOlderVersion(
                                newExtension: IExtension,
                                existingExtension: IExtension
                            ) {
                                return (
                                    (await confirmWithButtons(
                                        confirmMessage(newExtension),
                                        `The older version ${
                                            existingExtension.version
                                        } is already installed.${BUTTON_INSTRUCTIONS}`,
                                        BUTTONS
                                    )) === 0
                                );
                            },
                            async confirmReplaceTheSameVersion(
                                newExtension: IExtension,
                                existingExtension: IExtension
                            ) {
                                return (
                                    (await confirmWithButtons(
                                        confirmMessage(newExtension),
                                        `That version is already installed.${BUTTON_INSTRUCTIONS}`,
                                        BUTTONS
                                    )) === 0
                                );
                            }
                        });

                        if (extension) {
                            notification.success(
                                `Extension "${extension.displayName || extension.name}" installed`
                            );

                            extensionsManagerStore.selectExtensionById(extension.id);
                        }
                    } catch (err) {
                        notification.error(err.toString());
                    }
                }
            }
        );
    }

    render() {
        if (extensionsCatalog.isDownloadFinished) {
            return (
                <VerticalHeaderWithBody>
                    <ToolbarHeader>
                        <div style={{ flexGrow: 1 }}>
                            <label style={{ paddingRight: 5 }}>View:</label>
                            <label className="form-check-label">
                                <select
                                    className="form-control"
                                    value={extensionsManagerStore.viewFilter}
                                    onChange={action(
                                        (event: React.ChangeEvent<HTMLSelectElement>) =>
                                            (extensionsManagerStore.viewFilter = parseInt(
                                                event.currentTarget.value
                                            ))
                                    )}
                                >
                                    <option value={ViewFilter.ALL.toString()}>All</option>
                                    <option value={ViewFilter.INSTALLED.toString()}>
                                        Installed
                                    </option>
                                    <option value={ViewFilter.NOT_INSTALLED.toString()}>
                                        Not installed
                                    </option>
                                    <option value={ViewFilter.NEW_VERSIONS.toString()}>
                                        New versions
                                    </option>
                                </select>
                            </label>
                        </div>

                        <div>
                            <ButtonAction
                                text="Install Extension"
                                title="Install extension"
                                className="btn-success"
                                onClick={this.installExtension}
                            />
                        </div>
                    </ToolbarHeader>
                    <Body tabIndex={0}>
                        <List
                            nodes={extensionsManagerStore.extensionNodes}
                            renderNode={node => <ExtensionInMasterView extension={node.data} />}
                            selectNode={action(
                                (node: IListNode) =>
                                    (extensionsManagerStore.selectedExtension = node.data)
                            )}
                        />
                    </Body>
                </VerticalHeaderWithBody>
            );
        } else {
            return (
                <div className="EezStudio_Extensions_CatalogDownloadInfo">
                    <div>Downloading the latest extensions catalog...</div>
                    <Loader />
                </div>
            );
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

type SectionType = "properties" | "shortcuts";

interface ExtensionSectionsProps {
    extension: IExtension;
}

@observer
export class ExtensionSections extends React.Component<ExtensionSectionsProps, {}> {
    @observable
    activeSection: SectionType = "properties";
    @observable
    propertiesComponent: JSX.Element | undefined;

    constructor(props: ExtensionSectionsProps) {
        super(props);

        this.renderPropertiesComponent(this.props.extension);
    }

    renderPropertiesComponent(extension: IExtension) {
        if (extension.renderPropertiesComponent) {
            extension
                .renderPropertiesComponent()
                .then(propertiesComponent =>
                    runInAction(() => (this.propertiesComponent = propertiesComponent))
                );
        } else {
            runInAction(() => {
                this.propertiesComponent = undefined;
            });
        }
    }

    componentWillReceiveProps(nextProps: ExtensionSectionsProps) {
        if (this.props.extension !== nextProps.extension) {
            this.renderPropertiesComponent(nextProps.extension);
        }
    }

    @action
    activateSection(section: SectionType, event: any) {
        event.preventDefault();
        this.activeSection = section;
    }

    render() {
        let availableSections: SectionType[] = [];

        if (this.propertiesComponent) {
            availableSections.push("properties");
        }

        if (this.props.extension.properties && this.props.extension.properties.shortcuts) {
            availableSections.push("shortcuts");
        }

        if (availableSections.length === 0) {
            return null;
        }

        let activeSection = this.activeSection;

        if (availableSections.indexOf(activeSection) === -1) {
            activeSection = availableSections[0];
        }

        let navigationItems = availableSections.map(section => {
            let className = classNames("nav-link", {
                active: section === activeSection
            });

            return (
                <li key={section} className="nav-item">
                    <a
                        className={className}
                        href="#"
                        onClick={this.activateSection.bind(this, section)}
                    >
                        {humanize(section)}
                    </a>
                </li>
            );
        });

        let body;
        if (activeSection === "properties") {
            body = this.propertiesComponent;
        } else if (activeSection === "shortcuts") {
            body = <ExtensionShortcuts extension={this.props.extension} />;
        }

        return (
            <div>
                <div style={{ marginTop: "10px" }}>
                    <ul className="nav nav-tabs">{navigationItems}</ul>
                </div>

                <div
                    style={{
                        padding: "10px"
                    }}
                >
                    {body}
                </div>
            </div>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

@observer
export class DetailsView extends React.Component {
    @observable
    selectedVersion: string;

    constructor(props: any) {
        super(props);

        autorun(() => {
            const selectedExtensionVersions = extensionsManagerStore.selectedExtensionVersions;
            if (selectedExtensionVersions) {
                runInAction(
                    () => (this.selectedVersion = selectedExtensionVersions.versionInFocus.version)
                );
            }
        });
    }

    @computed
    get displayedExtension() {
        return extensionsManagerStore.getSelectedExtensionByVersion(this.selectedVersion);
    }

    @computed
    get extensionVersions() {
        return extensionsManagerStore.selectedExtensionVersions;
    }

    @computed
    get installEnabled() {
        return !(this.extensionVersions && this.extensionVersions.installedVersion);
    }

    @computed
    get updateEnabled() {
        return (
            this.extensionVersions &&
            this.extensionVersions.installedVersion &&
            this.displayedExtension === this.extensionVersions.installedVersion &&
            compareVersions(
                this.extensionVersions.latestVersion.version,
                this.extensionVersions.installedVersion.version
            ) > 0
        );
    }

    @computed
    get replaceEnabled() {
        return (
            this.extensionVersions &&
            this.extensionVersions.installedVersion &&
            this.displayedExtension !== this.extensionVersions.installedVersion
        );
    }

    @computed
    get uninstallEnabled() {
        return this.extensionVersions && this.extensionVersions.installedVersion;
    }

    async finishInstall(extensionZipPackageData: any, progressToastId: number) {
        const tempFilePath = await getTempFilePath();

        await writeBinaryData(tempFilePath, extensionZipPackageData);

        const extension = await installExtension(tempFilePath, {
            notFound() {
                notification.update(progressToastId, {
                    type: "error",
                    render: `Not a valid extension package file.`,
                    autoClose: 5000
                });
            },
            async confirmReplaceNewerVersion(
                newExtension: IExtension,
                existingExtension: IExtension
            ) {
                return true;
            },
            async confirmReplaceOlderVersion(
                newExtension: IExtension,
                existingExtension: IExtension
            ) {
                return true;
            },
            async confirmReplaceTheSameVersion(
                newExtension: IExtension,
                existingExtension: IExtension
            ) {
                return true;
            }
        });

        if (extension) {
            notification.update(progressToastId, {
                type: "success",
                render: `Extension "${extension.displayName || extension.name}" installed`
            });

            extensionsManagerStore.selectExtensionById(extension.id);
        }
    }

    @bind
    handleInstall() {
        if (!this.extensionVersions) {
            return;
        }

        let extensionToInstall = this.displayedExtension;
        if (!extensionToInstall) {
            return;
        }

        if (extensionToInstall === this.extensionVersions.installedVersion) {
            // if already installed then install latest version
            extensionToInstall = this.extensionVersions.latestVersion;
            if (!extensionToInstall) {
                return;
            }
        }

        if (!extensionToInstall.download) {
            return;
        }

        var req = new XMLHttpRequest();

        req.responseType = "arraybuffer";

        req.open("GET", extensionToInstall.download);

        req.addEventListener("progress", event => {
            notification.update(progressToastId, {
                render: `Downloading extension's package: ${event.loaded} of ${event.total} ...`
            });
        });

        req.addEventListener("load", () => {
            this.finishInstall(new Buffer(req.response), progressToastId).catch(error => {
                console.error("Extension download error", error);
                notification.update(progressToastId, {
                    type: "error",
                    render: "Failed to install extension.",
                    autoClose: 5000
                });
            });
        });

        req.addEventListener("error", error => {
            console.error("Extension download error", error);
            notification.update(progressToastId, {
                type: "error",
                render: "Failed to download extension package.",
                autoClose: 5000
            });
        });

        const progressToastId = notification.info("Downloading extension's package...", {
            autoClose: false,
            hideProgressBar: false
        });

        req.send();
    }

    @bind
    handleUninstall() {
        if (!this.extensionVersions) {
            return;
        }

        const extension = this.extensionVersions.installedVersion;
        if (!extension) {
            return;
        }

        confirm("Are you sure?", undefined, async () => {
            await uninstallExtension(extension.id);
            notification.success(
                `Extension "${extension.displayName || extension.name}" uninstalled`
            );
            extensionsManagerStore.selectExtensionById(extension.id);
        });
    }

    @bind
    handleExport() {
        if (!this.extensionVersions) {
            return;
        }

        const extension = this.extensionVersions.installedVersion;
        if (!extension) {
            return;
        }

        EEZStudio.electron.remote.dialog.showSaveDialog(
            EEZStudio.electron.remote.getCurrentWindow(),
            {
                filters: [
                    { name: "Extension files", extensions: ["zip"] },
                    { name: "All Files", extensions: ["*"] }
                ],
                defaultPath: getValidFileNameFromFileName(extension.name + ".zip")
            },
            async filePath => {
                if (filePath) {
                    try {
                        const tempFilePath = await getTempFilePath();
                        await exportExtension(extension, tempFilePath);
                        await copyFile(tempFilePath, filePath);
                        notification.success(`Saved to "${filePath}"`);
                    } catch (err) {
                        notification.error(err.toString());
                    }
                }
            }
        );
    }

    @bind
    handleChangeImage() {
        if (!this.extensionVersions) {
            return;
        }

        const extension = this.extensionVersions.installedVersion;
        if (!extension) {
            return;
        }

        EEZStudio.electron.remote.dialog.showOpenDialog(
            EEZStudio.electron.remote.getCurrentWindow(),
            {
                properties: ["openFile"],
                filters: [
                    { name: "Image files", extensions: ["png", "jpg", "jpeg"] },
                    { name: "All Files", extensions: ["*"] }
                ]
            },
            filePaths => {
                if (filePaths && filePaths[0]) {
                    changeExtensionImage(extension, filePaths[0]);
                }
            }
        );
    }

    render() {
        const extension = this.displayedExtension;
        if (!extension) {
            return null;
        }

        return (
            <VerticalHeaderWithBody>
                <Header className="EezStudio_Extension_Details_Header">
                    <div className="EezStudio_Extension_Details_Header_ImageContainer">
                        <img src={extension.image} width={256} />
                        <a href="#" style={{ cursor: "pointer" }} onClick={this.handleChangeImage}>
                            Change image
                        </a>
                    </div>
                    <div className="EezStudio_Extension_Details_Header_Properties">
                        <div className="EezStudio_Extension_Details_Header_Properties_Name_And_Version">
                            <h5>{extension.displayName || extension.name}</h5>
                            <div className="form-inline">
                                <label
                                    className="my-1 mr-2"
                                    htmlFor="EezStudio_Extension_Details_VersionSelect"
                                >
                                    Versions:
                                </label>
                                <select
                                    id="EezStudio_Extension_Details_VersionSelect"
                                    className="custom-select my-1 mr-sm-2"
                                    value={this.selectedVersion}
                                    onChange={action(
                                        (event: React.ChangeEvent<HTMLSelectElement>) => {
                                            this.selectedVersion = event.currentTarget.value;
                                        }
                                    )}
                                >
                                    {this.extensionVersions!.allVersions.map(extension => (
                                        <option key={extension.version} value={extension.version}>
                                            {extension.version}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div>{extension.description}</div>
                        <div>{extension.author}</div>
                        <div style={{ marginBottom: "10px" }}>
                            <small>{extension.id}</small>
                        </div>
                        <Toolbar>
                            {this.installEnabled && (
                                <ButtonAction
                                    text="Install"
                                    title="Install extension"
                                    className="btn-success"
                                    onClick={this.handleInstall}
                                />
                            )}
                            {this.updateEnabled && (
                                <ButtonAction
                                    text="Update"
                                    title="Update extension to the latest version"
                                    className="btn-success"
                                    onClick={this.handleInstall}
                                />
                            )}
                            {this.replaceEnabled && (
                                <ButtonAction
                                    text="Replace"
                                    title="Replace installed extension with selected version"
                                    className="btn-success"
                                    onClick={this.handleInstall}
                                />
                            )}
                            {this.uninstallEnabled && (
                                <ButtonAction
                                    text="Uninstall"
                                    title="Uninstall extension"
                                    className="btn-danger"
                                    onClick={this.handleUninstall}
                                />
                            )}
                            {extension.isEditable &&
                                extension.isDirty && (
                                    <ButtonAction
                                        text="Export"
                                        title="Export extension"
                                        className="btn-secondary"
                                        onClick={this.handleExport}
                                    />
                                )}
                        </Toolbar>
                    </div>
                </Header>
                <Body>
                    <ExtensionSections extension={extension} />
                </Body>
            </VerticalHeaderWithBody>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

@observer
export class ExtensionsManager extends React.Component {
    render() {
        return (
            <Splitter
                type="horizontal"
                sizes="240px|100%"
                persistId="home/extensions-manager/splitter"
            >
                <MasterView />
                <DetailsView />
            </Splitter>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

scheduleTask("Download extensions catalog", Priority.Lowest, () => {
    extensionsCatalog.download();
});
