// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {BaseERC20} from "../tokens/BaseERC20.sol";

// interfaces
import {IVirtualToken} from "../interfaces/IVirtualToken.sol";

contract MintableERC20 is IVirtualToken, BaseERC20 {
    constructor(string memory _name, string memory _symbol) BaseERC20(_name, _symbol) {}

    function mint(uint256 amount) external override {
        _mint(msg.sender, amount);
    }

    function burn(uint256 amount) external override {
        _burn(msg.sender, amount);
    }
}
