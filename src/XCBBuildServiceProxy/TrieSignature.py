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

    def search_any(self, signature, search_from_index=0, first_sub_signature=True):
        node = self.root
        for i in range(search_from_index, len(signature)):
            if first_sub_signature and node.data is not None:
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


if __name__ == "__main__":
    # Test code for TrieSignature
    import random as Random

    trie = TrieSignature()

    st = {}

    def check():
        for signature, data in st.items():
            fdata = trie.search_any(signature, first_sub_signature=False)
            assert fdata == data

    def traverse_check(node, path):
        if node.data is not None:
            fdata = st.get(tuple(path))
            assert fdata == node.data

        for byte, child in node.children.items():
            traverse_check(child, path + [byte])

    for i in range(1000000):
        if Random.random() < 0.2:
            if len(st) == 0:
                continue
            val = list(st)[Random.randint(0, len(st) - 1)]
            trie.remove_signature(val)
            del st[val]
        else:
            n = Random.randint(1, 20)
            signature = [Random.randint(1, 10) for _ in range(n)]
            st[tuple(signature)] = i
            trie.insert(signature, i)
        check()
        traverse_check(trie.root, [])
