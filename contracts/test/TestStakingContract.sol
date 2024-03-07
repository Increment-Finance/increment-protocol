// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {IncreAccessControl} from "../utils/IncreAccessControl.sol";

// interfaces
import {IClearingHouse} from "../interfaces/IClearingHouse.sol";
import {IStakingContract} from "../interfaces/IStakingContract.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// libraries
import {LibPerpetual} from "../lib/LibPerpetual.sol";
import {LibMath} from "../lib/LibMath.sol";

contract TestStakingContract is IStakingContract, IncreAccessControl {
    using LibMath for int256;

    /// @notice Emitted when the sender is not the owner
    error StakingContract_SenderNotClearingHouse();

    /// @notice Emitted when a new ClearingHouse is connected to the vault
    /// @param newClearingHouse New ClearingHouse contract address
    event ClearingHouseChanged(IClearingHouse newClearingHouse);

    modifier onlyClearingHouse() {
        if (msg.sender != address(clearingHouse)) revert StakingContract_SenderNotClearingHouse();
        _;
    }

    // staking logic
    IERC20Metadata public immutable rewardsToken;
    IClearingHouse public clearingHouse;

    constructor(IClearingHouse _clearingHouse, IERC20Metadata _rewardToken) {
        clearingHouse = _clearingHouse;
        rewardsToken = _rewardToken;
    }

    function updateStakingPosition(uint256 idx, address lp) public override onlyClearingHouse updateReward(lp) {
        LibPerpetual.LiquidityProviderPosition memory lpPosition = clearingHouse.perpetuals(idx).getLpPosition(lp);

        uint256 oldBalance = balanceOf[lp];
        uint256 newBalance = int256(lpPosition.openNotional).abs().toUint256();

        if (oldBalance < newBalance) {
            totalSupply += newBalance - oldBalance;
            balanceOf[lp] = newBalance;
        } else if (oldBalance > newBalance) {
            totalSupply -= oldBalance - newBalance;
            balanceOf[lp] = newBalance;
        }
    }

    function setClearingHouse(IClearingHouse newClearingHouse) external onlyRole(GOVERNANCE) {
        if (address(newClearingHouse) == address(0)) revert StakingContract_SenderNotClearingHouse();
        clearingHouse = newClearingHouse;
        emit ClearingHouseChanged(newClearingHouse);
    }

    // modified from https://solidity-by-example.org/defi/staking-rewards/

    ////////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////
    // Duration of rewards to be paid out (in seconds)
    uint256 public duration;
    // Timestamp of when the rewards finish
    uint256 public finishAt;
    // Minimum of last updated time and reward finish time
    uint256 public updatedAt;
    // Reward to be paid out per second
    uint256 public rewardRate;
    // Sum of (reward rate * dt * 1e18 / total supply)
    uint256 public rewardPerTokenStored;
    // User address => rewardPerTokenStored
    mapping(address => uint256) public userRewardPerTokenPaid;
    // User address => rewards to be claimed
    mapping(address => uint256) public rewards;

    // Total staked
    uint256 public totalSupply;
    // User address => staked amount
    mapping(address => uint256) public balanceOf;

    modifier updateReward(address _account) {
        rewardPerTokenStored = rewardPerToken();
        updatedAt = lastTimeRewardApplicable();

        if (_account != address(0)) {
            rewards[_account] = earned(_account);
            userRewardPerTokenPaid[_account] = rewardPerTokenStored;
        }

        _;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return _min(finishAt, block.timestamp);
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) {
            return rewardPerTokenStored;
        }

        return rewardPerTokenStored + (rewardRate * (lastTimeRewardApplicable() - updatedAt) * 1e18) / totalSupply;
    }

    function earned(address _account) public view returns (uint256) {
        return
            ((balanceOf[_account] * (rewardPerToken() - userRewardPerTokenPaid[_account])) / 1e18) + rewards[_account];
    }

    function getReward() external updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardsToken.transfer(msg.sender, reward);
        }
    }

    function setRewardsDuration(uint256 _duration) external onlyRole(GOVERNANCE) {
        require(finishAt < block.timestamp, "reward duration not finished");
        duration = _duration;
    }

    function notifyRewardAmount(uint256 _amount) external onlyRole(GOVERNANCE) updateReward(address(0)) {
        if (block.timestamp >= finishAt) {
            rewardRate = _amount / duration;
        } else {
            uint256 remainingRewards = (finishAt - block.timestamp) * rewardRate;
            rewardRate = (_amount + remainingRewards) / duration;
        }

        require(rewardRate > 0, "reward rate = 0");
        require(rewardRate * duration <= rewardsToken.balanceOf(address(this)), "reward amount > balance");

        finishAt = block.timestamp + duration;
        updatedAt = block.timestamp;
    }

    function _min(uint256 x, uint256 y) private pure returns (uint256) {
        return x <= y ? x : y;
    }
}
