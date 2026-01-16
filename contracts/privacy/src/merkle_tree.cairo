#[starknet::interface]
pub trait IMerkleTree<TContractState> {
    fn is_valid_root(self: @TContractState, root: u256) -> bool;
    fn add_root_with_path(ref self: TContractState, leaf: u256, path: Span<u256>, index: u64, root: u256);
}

#[starknet::component]
pub mod MerkleTreeComponent {
    use starknet::storage::{StorageMapReadAccess, StorageMapWriteAccess, Map};
    
    #[storage]
    pub struct Storage {
        pub valid_roots: Map<u256, bool>,
    }

    #[embeddable_as(MerkleTreeImpl)]
    impl MerkleTree<TContractState, +HasComponent<TContractState>> of super::IMerkleTree<ComponentState<TContractState>> {
        fn is_valid_root(self: @ComponentState<TContractState>, root: u256) -> bool {
            self.valid_roots.read(root)
        }

        fn add_root_with_path(ref self: ComponentState<TContractState>, leaf: u256, path: Span<u256>, index: u64, root: u256) {
            self.valid_roots.write(root, true);
        }
    }
}
