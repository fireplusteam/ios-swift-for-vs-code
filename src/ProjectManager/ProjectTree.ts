import * as path from "path";

type Node = {
    isVisible: boolean;
    isLeaf: boolean;
    edges: Map<string, [string, Node]> | null;
};

export class ProjectTree {
    private root: Node;

    constructor() {
        this.root = { isVisible: false, isLeaf: false, edges: null };
    }

    addExcluded(filePath: string) {
        const components = filePath.split(path.sep);
        if (components.length <= 1) {
            return;
        }
        this.add(this.root, components, false, 0, false);
    }

    addIncluded(filePath: string, includeSubfolders = true) {
        const components = filePath.split(path.sep);
        if (components.length <= 1) {
            return;
        }
        this.add(this.root, components, true, 0, includeSubfolders);
    }

    excludedFiles() {
        const list: string[] = [];
        const included: boolean[] = [];
        const filePath: string[] = [];
        function toPath(components: string[]) {
            if (components.length === 0) {
                return "";
            }
            return path.join(...components);
        }
        function excludedFiles(node: Node | undefined) {
            if (node === undefined || (node.isLeaf && node.isVisible)) {
                return false;
            }
            if (node.edges === null) {
                if (!node.isVisible) {
                    list.push(toPath(filePath));
                    included.push(true);
                    return true;
                }
                return false;
            }
            if (!node.isVisible) {
                list.push(toPath(filePath));
                included.push(true);
                return true;
            }
            const childsIdx: number[] = [];
            const childsValues: string[] = [];
            for (const [, value] of node.edges) {
                filePath.push(value[0]);
                if (excludedFiles(value[1])) {
                    childsIdx.push(list.length - 1);
                    childsValues.push(value[0]);
                }
                filePath.pop();
            }
            if (childsIdx.length > 1) {
                // try to group all leafs with the same parent, for example:
                // /User/root_folder/sub/project.pbxproj
                // /User/root_folder/sub/file.swift
                // can be grouped to /User/root_folder/sub/{project.pbxproj,file.swift}
                const concatPath = childsValues.join(",");
                for (const idx of childsIdx) {
                    included[idx] = false;
                }
                list.push(`${toPath(filePath)}/{${concatPath}}`);
                included.push(true);
            }
            return false;
        }

        excludedFiles(this.root);
        return list.filter((_, idx) => included[idx]);
    }

    private add(
        node: Node | undefined,
        components: string[],
        isVisible: boolean,
        index: number,
        includeSubfolders: boolean
    ) {
        if (node === undefined) {
            return;
        }
        if (index >= components.length) {
            if (!isVisible) {
                return;
            }
            if (includeSubfolders) {
                node.isLeaf = true;
            } // if it's visible, tells that's a leaf
            return;
        }
        if (isVisible) {
            node.isVisible = true;
        }
        if (!isVisible && node.isLeaf) {
            return;
        }
        const edges = node.edges || new Map<string, [string, Node]>();
        if (!edges.has(components[index].toLowerCase())) {
            edges.set(components[index].toLowerCase(), [
                components[index],
                {
                    isVisible: isVisible,
                    isLeaf: index === components.length - 1 && includeSubfolders ? true : false,
                    edges: null,
                },
            ]);
        }
        node.edges = edges;
        const key = edges.get(components[index].toLowerCase());
        this.add(key?.[1], components, isVisible, index + 1, includeSubfolders);
    }
}
