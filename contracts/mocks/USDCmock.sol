// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IncreAccessControl} from "../utils/IncreAccessControl.sol";

contract USDCmock is ERC20, Ownable {
    uint8 public _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function mint(address _to, uint256 _amount) public onlyOwner {
        _mint(_to, _amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}
