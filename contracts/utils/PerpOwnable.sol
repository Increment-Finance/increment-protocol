// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

/// @notice Emitted when the sender is not perp
error PerpOwnable_NotOwner();

/// @notice Emitted when the proposed address is equal to the zero address
error PerpOwnable_TransferZeroAddress();

/// @notice Emitted when the ownership of the contract has already been claimed
error PerpOwnable_OwnershipAlreadyClaimed();

/// @notice Perp access control contract, simplified of OpenZeppelin's Ownable.sol
/// @dev Ownership can only be transferred once
contract PerpOwnable {
    address public perp;

    event PerpOwnerTransferred(address indexed sender, address indexed recipient);

    /// @notice Access control modifier that requires modified function to be called by the perp contract
    modifier onlyPerp() {
        if (msg.sender != perp) revert PerpOwnable_NotOwner();
        _;
    }

    /// @notice Transfer `perp` account
    /// @notice Can only be used at deployment as Perpetual can't transfer ownership afterwards
    /// @param recipient Account granted `perp` access control.
    function transferPerpOwner(address recipient) external {
        if (recipient == address(0)) revert PerpOwnable_TransferZeroAddress();
        if (perp != address(0)) revert PerpOwnable_OwnershipAlreadyClaimed();

        perp = recipient;
        emit PerpOwnerTransferred(msg.sender, recipient);
    }
}
