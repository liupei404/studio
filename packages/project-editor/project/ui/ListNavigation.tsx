import React from "react";
import { computed, observable, action, reaction } from "mobx";
import { observer } from "mobx-react";
import { bind } from "bind-decorator";

import { IconAction } from "eez-studio-ui/action";
import { Splitter } from "eez-studio-ui/splitter";
import { styled } from "eez-studio-ui/styled-components";

import {
    EezObject,
    NavigationComponentProps,
    objectToString
} from "eez-studio-shared/model/object";
import { ListAdapter, SortDirectionType } from "eez-studio-shared/model/objectAdapter";
import {
    NavigationStore,
    EditorsStore,
    UIStateStore,
    addItem,
    deleteItem,
    canAdd,
    canDelete
} from "eez-studio-shared/model/store";
import { List } from "eez-studio-shared/model/components/List";

import { Panel } from "eez-studio-shared/model/components/Panel";

////////////////////////////////////////////////////////////////////////////////

const SortableTitleDiv = styled.div`
    flex-grow: 1;
    margin-top: 5px;
    margin-left: 5px;
    font-weight: 600;
    color: ${props => props.theme.darkTextColor};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    background-repeat: no-repeat;
    background-position: center left;
    padding-left: 20px;
    cursor: pointer;

    &.sort-asc {
        background-image: url("../eez-studio-ui/_images/col_sort_asc.png");
    }

    &.sort-desc {
        background-image: url("../eez-studio-ui/_images/col_sort_desc.png");
    }

    &.sort-none {
        background-image: url("../eez-studio-ui/_images/col_sort_enabled.png");
    }
`;

@observer
export class SortableTitle extends React.Component<{
    title: string;
    direction: SortDirectionType;
    onDirectionChanged: (direction: SortDirectionType) => void;
}> {
    @bind
    onClicked() {
        if (this.props.direction === "asc") {
            this.props.onDirectionChanged("desc");
        } else if (this.props.direction === "desc") {
            this.props.onDirectionChanged("none");
        } else {
            this.props.onDirectionChanged("asc");
        }
    }

    render() {
        const { title, direction } = this.props;

        return (
            <SortableTitleDiv className={"sort-" + direction} onClick={this.onClicked}>
                {title}
            </SortableTitleDiv>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

@observer
export class AddButton extends React.Component<{
    navigationObject: EezObject | undefined;
}> {
    onAdd() {
        if (this.props.navigationObject) {
            addItem(this.props.navigationObject);
        }
    }

    render() {
        return (
            <IconAction
                title="Add Item"
                icon="material:add"
                iconSize={16}
                onClick={this.onAdd.bind(this)}
                enabled={this.props.navigationObject && canAdd(this.props.navigationObject)}
            />
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

@observer
export class DeleteButton extends React.Component<{
    navigationObject: EezObject | undefined;
}> {
    onDelete() {
        let selectedItem =
            this.props.navigationObject &&
            NavigationStore.getNavigationSelectedItemAsObject(this.props.navigationObject);
        if (selectedItem) {
            deleteItem(selectedItem);
        }
    }

    render() {
        let selectedItem =
            this.props.navigationObject &&
            NavigationStore.getNavigationSelectedItemAsObject(this.props.navigationObject);

        return (
            <IconAction
                title="Delete Selected Item"
                icon="material:delete"
                iconSize={16}
                onClick={this.onDelete.bind(this)}
                enabled={selectedItem && canDelete(selectedItem)}
            />
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

interface ListNavigationProps {
    id: string;
    title?: string;
    navigationObject: EezObject;
    onDoubleClickItem?: (item: EezObject) => void;
    additionalButtons?: JSX.Element[];
}

@observer
export class ListNavigation extends React.Component<ListNavigationProps, {}> {
    @observable sortDirection: SortDirectionType = "none";

    constructor(props: any) {
        super(props);

        const sortDirectionStr = localStorage.getItem(
            "ListNavigationSortDirection" + this.props.id
        );
        if (sortDirectionStr) {
            this.sortDirection = sortDirectionStr as SortDirectionType;
        }

        reaction(
            () => this.sortDirection,
            sortDirection =>
                localStorage.setItem("ListNavigationSortDirection" + this.props.id, sortDirection)
        );
    }

    @bind
    onDoubleClickItem(object: EezObject) {
        if (this.props.onDoubleClickItem) {
            this.props.onDoubleClickItem(object);
        } else if (EditorsStore.activeEditor && EditorsStore.activeEditor.object == object) {
            EditorsStore.activeEditor.makePermanent();
        }
    }

    @computed
    get selectedObject() {
        let selectedItem = NavigationStore.getNavigationSelectedItem(
            this.props.navigationObject
        ) as EezObject;
        return selectedItem || NavigationStore.selectedObject;
    }

    @computed
    get listAdapter() {
        return new ListAdapter(
            this.props.navigationObject,
            this.sortDirection,
            this.onDoubleClickItem
        );
    }

    onFocus() {
        NavigationStore.setSelectedPanel(this);
    }

    render() {
        const title = (
            <SortableTitle
                title={this.props.title || objectToString(this.props.navigationObject)}
                direction={this.sortDirection}
                onDirectionChanged={action(
                    (direction: SortDirectionType) => (this.sortDirection = direction)
                )}
            />
        );

        const buttons: JSX.Element[] = [];

        if (this.props.additionalButtons) {
            buttons.push(...this.props.additionalButtons);
        }

        buttons.push(<AddButton key="add" navigationObject={this.props.navigationObject} />);
        buttons.push(<DeleteButton key="delete" navigationObject={this.props.navigationObject} />);

        return (
            <Panel
                id="navigation"
                title={title}
                buttons={buttons}
                body={
                    <List
                        listAdapter={this.listAdapter}
                        tabIndex={0}
                        onFocus={this.onFocus.bind(this)}
                    />
                }
            />
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

interface ListNavigationWithContentProps extends NavigationComponentProps {
    title?: string;
    onDoubleClickItem?: (item: EezObject) => void;
    additionalButtons?: JSX.Element[];
}

@observer
export class ListNavigationWithContent extends React.Component<ListNavigationWithContentProps, {}> {
    render() {
        if (UIStateStore.viewOptions.navigationVisible) {
            return (
                <Splitter
                    type="horizontal"
                    persistId={`project-editor/navigation-${this.props.id}`}
                    sizes={`240px|100%`}
                    childrenOverflow="hidden"
                >
                    <ListNavigation
                        id={this.props.id}
                        title={this.props.title}
                        navigationObject={this.props.navigationObject}
                        onDoubleClickItem={this.props.onDoubleClickItem}
                        additionalButtons={this.props.additionalButtons}
                    />
                    {this.props.content}
                </Splitter>
            );
        } else {
            return this.props.content;
        }
    }
}
