// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

interface IStakingContract {
    /* ****************** */
    /*  State modifying   */
    /* ****************** */

    function updateStakingPosition(uint256 idx, address lp) external;
}
