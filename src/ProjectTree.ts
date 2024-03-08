import path from "path";


type Node = {
    isVisible: boolean;
    isLeaf: boolean,
    edges: Map<string, [string, Node]> | null;
}

export class ProjectTree {
    root: Node;

    constructor() {
        this.root = { isVisible: false, isLeaf: false, edges: null };
    }

    addExcluded(filePath: string) {
        const components = filePath.split(path.sep);
        if (components.length <= 1) {
            return;
        }
        this.add(this.root, components, false, 0);
    }

    addIncluded(filePath: string) {
        const components = filePath.split(path.sep);
        if (components.length <= 1) {
            return;
        }
        this.add(this.root, components, true, 0);
    }

    excludedFiles() {
        const list: string[] = [];
        function excludedFiles(node: Node | undefined, filePath: string) {
            if (node === undefined)
                return;
            if (node.isLeaf && node.isVisible) {
                return;
            }
            if (node.edges === null) {
                if (!node.isVisible) {
                    list.push(filePath);
                }
                return;
            }
            if (!node.isVisible) {
                list.push(filePath);
                return;
            }
            for (let [key, value] of node.edges) {
                excludedFiles(value[1], path.join(filePath, value[0]));
            }
        }

        excludedFiles(this.root, "");
        return list;
    }

    private add(node: Node | undefined, components: string[], isVisible: boolean, index: number) {
        if (node === undefined)
            return;
        if (index >= components.length) {
            if (!isVisible) {
                return;
            }
            node.isLeaf = true; // if it's visible, tells that's a leaf
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
            edges.set(components[index].toLowerCase(), [components[index], {
                isVisible: isVisible,
                isLeaf: index == components.length - 1 ? true : false,
                edges: null
            }]);
        }
        node.edges = edges;
        const key = edges.get(components[index].toLowerCase());
        this.add(key?.[1], components, isVisible, index + 1);
    }
}