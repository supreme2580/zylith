#[starknet::interface]
pub trait INullifierRegistry<TContractState> {
    fn is_nullified(self: @TContractState, nullifier: felt252) -> bool;
    fn nullify(ref self: TContractState, nullifier: felt252);
}

#[starknet::contract]
mod NullifierRegistry {
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    #[storage]
    struct Storage {
        nullifiers: Map<felt252, bool>,
    }

    #[abi(embed_v0)]
    impl NullifierRegistryImpl of super::INullifierRegistry<ContractState> {
        fn is_nullified(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.read(nullifier)
        }

        fn nullify(ref self: ContractState, nullifier: felt252) {
            let already_nullified = self.nullifiers.read(nullifier);
            assert(!already_nullified, 'Already nullified');
            self.nullifiers.write(nullifier, true);
        }
    }
}
