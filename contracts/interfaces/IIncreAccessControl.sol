// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

interface IIncreAccessControl is IAccessControl {
    /* ****************** */
    /*     Events         */
    /* ****************** */

    /* ****************** */
    /*     Viewer         */
    /* ****************** */

    function isGovernor(address account) external view returns (bool);

    function isManager(address account) external view returns (bool);

    /* ****************** */
    /*  State modifying   */
    /* ****************** */

    function setRoleAdmin(bytes32 role, bytes32 adminRole) external;
}
