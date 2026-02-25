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
        const filePath: string[] = [];
        function excludedFiles(node: Node | undefined) {
            if (node === undefined) {
                return;
            }
            if (node.isLeaf && node.isVisible) {
                return;
            }
            if (node.edges === null) {
                if (!node.isVisible) {
                    if (filePath.length > 0) {
                        list.push(path.join(...filePath));
                    } else {
                        list.push("");
                    }
                }
                return;
            }
            if (!node.isVisible) {
                if (filePath.length > 0) {
                    list.push(path.join(...filePath));
                } else {
                    list.push("");
                }
                return;
            }
            for (const [, value] of node.edges) {
                filePath.push(value[0]);
                excludedFiles(value[1]);
                filePath.pop();
            }
        }

        excludedFiles(this.root);
        return list;
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
