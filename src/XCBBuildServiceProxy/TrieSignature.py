class TrieNode:
    def __init__(self):
        self.children = {}
        self.data = None


class TrieSignature:
    def __init__(self):
        self.root = TrieNode()

    def insert(self, signature, data):
        node = self.root
        for byte in signature:
            if not byte in node.children:
                node.children[byte] = TrieNode()
            node = node.children[byte]
        node.data = data

    def search_any(self, signature, search_from_index=0):
        node = self.root
        for i in range(search_from_index, len(signature)):
            if node.data is not None:
                return node.data
            byte = signature[i]
            if not byte in node.children:
                return None
            node = node.children[byte]
        return node.data

    def remove_signature(self, signature):
        def recursive_remove(root, index):
            if index == len(signature):
                if root.data is not None:
                    root.data = None
                    return True
                return False

            byte = signature[index]
            if not byte in root.children:
                return False

            child_node = root.children[byte]
            if recursive_remove(child_node, index + 1):
                if len(child_node.children) == 0 and child_node.data is None:
                    del root.children[byte]
                return True
            return False

        return recursive_remove(self.root, 0)
