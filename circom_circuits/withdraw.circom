pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template MerkleTreeInclusion(height) {
    signal input leaf;
    signal input path_elements[height];
    signal input path_indices[height];
    signal output root;

    component hashers[height];
    signal level_hashes[height + 1];
    level_hashes[0] <== leaf;

    for (var i = 0; i < height; i++) {
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== level_hashes[i] + path_indices[i] * (path_elements[i] - level_hashes[i]);
        hashers[i].inputs[1] <== path_elements[i] + path_indices[i] * (level_hashes[i] - path_elements[i]);
        level_hashes[i + 1] <== hashers[i].out;
    }

    root <== level_hashes[height];
}

template ZylithWithdraw() {
    // Private
    signal input secret;
    signal input nullifier;
    signal input balance;
    signal input path_elements[25];
    signal input path_indices[25];

    // Public
    signal input root;
    signal input nullifier_hash;
    signal input amount;
    signal input change_commitment;

    // 1. Verify Source Note Commitment
    component noteHasher = Poseidon(2);
    noteHasher.inputs[0] <== secret;
    noteHasher.inputs[1] <== nullifier;
    
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== noteHasher.out;
    commitmentHasher.inputs[1] <== balance;
    
    // 2. Verify Membership
    component inclusion = MerkleTreeInclusion(25);
    inclusion.leaf <== commitmentHasher.out;
    for (var i = 0; i < 25; i++) {
        inclusion.path_elements[i] <== path_elements[i];
        inclusion.path_indices[i] <== path_indices[i];
    }
    inclusion.root === root;

    // 3. Verify Nullifier
    component nHasher = Poseidon(2);
    nHasher.inputs[0] <== secret;
    nHasher.inputs[1] <== commitmentHasher.out;
    nHasher.out === nullifier_hash;

    // 4. Balance Check: amount <= balance
    component checkBalance = GreaterEqThan(128);
    checkBalance.in[0] <== balance;
    checkBalance.in[1] <== amount;
    checkBalance.out === 1;
    
    // 5. Change Commitment (if any remaining balance)
    // If change_commitment == 0, full withdrawal (change_amount = 0)
    // Otherwise, change_commitment = Poseidon(Poseidon(secret, nullifier), change_amount)
    signal change_amount;
    change_amount <-- balance - amount;
    
    // Verify change commitment: if change_amount > 0, then change_commitment must match
    component changeCommitmentHasher = Poseidon(2);
    changeCommitmentHasher.inputs[0] <== noteHasher.out;
    changeCommitmentHasher.inputs[1] <== change_amount;
    
    // If change_amount == 0, change_commitment must be 0
    // Otherwise, change_commitment must equal the computed value
    signal change_is_zero;
    change_is_zero <-- (change_amount == 0) ? 1 : 0;
    
    // Enforce: if change_amount == 0, change_commitment == 0
    // Otherwise, change_commitment == changeCommitmentHasher.out
    (1 - change_is_zero) * (change_commitment - changeCommitmentHasher.out) === 0;
    change_is_zero * change_commitment === 0;
}

component main {public [root, nullifier_hash, amount, change_commitment]} = ZylithWithdraw();
