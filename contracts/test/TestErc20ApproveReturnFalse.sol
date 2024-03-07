// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {BaseERC20} from "../tokens/BaseERC20.sol";

contract TestErc20ApproveReturnFalse is BaseERC20 {
    constructor() BaseERC20("Increment Unit of Account", "UA") {}

    function approve(address, uint256) external virtual override returns (bool) {
        return false;
    }
}
