// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {Insurance} from "../Insurance.sol";

// interfaces
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IVault} from "../interfaces/IVault.sol";

contract TestInsurance is Insurance {
    constructor(IERC20Metadata _token, IVault _vault) Insurance(_token, _vault) {}

    function __TestInsurance_fundInsurance(uint256 amount) external {
        return _fundInsurance(amount);
    }

    function __TestInsurance_setSystemBadDebt(uint256 newSystemBadDebt) external {
        systemBadDebt = newSystemBadDebt;
    }
}
