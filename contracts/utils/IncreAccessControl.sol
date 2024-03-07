// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

// interfaces
import {IIncreAccessControl} from "../interfaces/IIncreAccessControl.sol";

/// @notice Increment access control contract.
contract IncreAccessControl is AccessControl {
    bytes32 public constant GOVERNANCE = keccak256("GOVERNANCE");
    bytes32 public constant MANAGER = keccak256("MANAGER");

    constructor() {
        _setupRole(GOVERNANCE, msg.sender);
        _setRoleAdmin(GOVERNANCE, GOVERNANCE);

        _setupRole(MANAGER, msg.sender);
        _setRoleAdmin(MANAGER, GOVERNANCE);
    }

    // utils
    function isGovernor(address account) external view returns (bool) {
        return hasRole(GOVERNANCE, account);
    }

    function isManager(address account) external view returns (bool) {
        return hasRole(MANAGER, account);
    }
}
