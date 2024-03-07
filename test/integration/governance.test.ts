import {expect} from 'chai';
import {getProceedsFromClosingLongPosition} from '../helpers/TradingGetters';
import {depositCollateralAndProvideLiquidity} from '../helpers/PerpetualUtilsFunctions';
import {createUABalance, setup, User} from '../helpers/setup';
import {asBigNumber, rMul} from '../helpers/utils/calculations';
import {ZERO_ADDRESS, DEAD_ADDRESS} from '../../helpers/constants';
import {
  ClearingHouseErrors,
  PerpetualErrors,
  VaultErrors,
  VBaseErrors,
  AccessControlErrors,
} from '../../helpers/errors';
import {days, minutes} from '../../helpers/time';
import {IClearingHouse} from '../../typechain/contracts/ClearingHouse';
import {IPerpetual} from '../../typechain/contracts/Perpetual';
import {BytesLike} from 'ethers';

const newPerpAddress = '0x494E435245000000000000000000000000000000';
const VALID_GRACE_PERIOD = minutes(10);

describe('Increment Protocol: Governance', function () {
  let deployer: User;
  let user: User;
  let lp: User;
  let GOVERNANCE: BytesLike, MANAGER: BytesLike;

  beforeEach('Set up', async () => {
    ({user, deployer, lp} = await setup());
    GOVERNANCE = await deployer.clearingHouse.GOVERNANCE();
    MANAGER = await deployer.clearingHouse.MANAGER();
  });

  describe('IncreAccessControl', function () {
    it('Can transfer roles from deployer', async function () {
      await expect(deployer.clearingHouse.grantRole(GOVERNANCE, user.address))
        .to.emit(user.clearingHouse, 'RoleGranted')
        .withArgs(GOVERNANCE, user.address, deployer.address);
      expect(await user.clearingHouse.isGovernor(user.address)).to.be.true;

      await expect(deployer.clearingHouse.grantRole(MANAGER, user.address))
        .to.emit(user.clearingHouse, 'RoleGranted')
        .withArgs(MANAGER, user.address, deployer.address);
      expect(await user.clearingHouse.isManager(user.address)).to.be.true;

      await expect(user.clearingHouse.renounceRole(MANAGER, user.address))
        .to.emit(user.clearingHouse, 'RoleRevoked')
        .withArgs(MANAGER, user.address, user.address);
      expect(await user.clearingHouse.isManager(user.address)).to.be.false;
    });
  });

  describe('Allowlist markets', function () {
    it('User should not be able to allowlist market ', async function () {
      await expect(
        user.clearingHouse.allowListPerpetual(newPerpAddress)
      ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));
    });

    it('Deployer should not be able to allowlist the same market more than once', async function () {
      const numMarkets = await user.clearingHouse.getNumMarkets();
      expect(numMarkets).to.eq(1);

      const firstMarket = await user.clearingHouse.perpetuals(0);

      await expect(
        deployer.clearingHouse.allowListPerpetual(firstMarket)
      ).to.revertedWith(ClearingHouseErrors.PerpetualMarketAlreadyAssigned);

      expect(await deployer.clearingHouse.getNumMarkets()).to.eq(numMarkets);
    });

    it('Deployer should fail to allowList a market at address(0)', async function () {
      await expect(
        deployer.clearingHouse.allowListPerpetual(ZERO_ADDRESS)
      ).to.revertedWith(ClearingHouseErrors.ZeroAddress);
    });

    it('Deployer should be able to allowlist market ', async function () {
      const numMarkets = await user.clearingHouse.getNumMarkets();

      await expect(deployer.clearingHouse.allowListPerpetual(newPerpAddress))
        .to.emit(deployer.clearingHouse, 'MarketAdded')
        .withArgs(newPerpAddress, numMarkets.add(1));

      expect(await deployer.clearingHouse.getNumMarkets()).to.eq(
        numMarkets.add(1)
      );
      expect(await deployer.clearingHouse.perpetuals(1)).to.eq(newPerpAddress);
    });
  });

  describe('Change Vault contract', function () {
    it('Changing vault oracle should not work if user is not owner', async function () {
      await expect(
        user.vault.setOracle(user.oracle.address)
      ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));
    });

    it('Changing vault oracle should not work if owner pass 0 address', async function () {
      await expect(deployer.vault.setOracle(ZERO_ADDRESS)).to.be.revertedWith(
        VaultErrors.OracleZeroAddress
      );
    });

    it('Owner should be able to set oracle to vault', async function () {
      await expect(deployer.vault.setOracle(deployer.oracle.address))
        .to.emit(deployer.vault, 'OracleChanged')
        .withArgs(deployer.oracle.address);
    });
  });

  describe('Change vBase contract', function () {
    it('Changing heart beat should not work if user is not governance address', async function () {
      await expect(user.vBase.setHeartBeat(0)).to.be.revertedWith(
        AccessControlErrors.revertGovernance(user.address)
      );
    });

    it('Changing heart beat should work if user is governance address', async function () {
      await expect(deployer.vBase.setHeartBeat(0))
        .to.emit(deployer.vBase, 'HeartBeatUpdated')
        .withArgs(0);

      expect(await deployer.vBase.heartBeat()).to.eq(0);
    });

    it('Should fail to set new sequencer uptime feed if not governance address', async () => {
      await expect(
        user.vBase.setSequencerUptimeFeed(DEAD_ADDRESS)
      ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));
    });

    it('Should fail to set new sequencer uptime feed if 0 address', async () => {
      await expect(
        deployer.vBase.setSequencerUptimeFeed(ZERO_ADDRESS)
      ).to.be.revertedWith(VBaseErrors.SequencerUptimeFeedZeroAddress);
    });

    it('Should work to set new valid sequencer uptime feed', async () => {
      const initialSequencerUptimeFeed =
        await deployer.vBase.sequencerUptimeFeed();

      await expect(deployer.vBase.setSequencerUptimeFeed(DEAD_ADDRESS))
        .to.emit(deployer.vBase, 'SequencerUptimeFeedUpdated')
        .withArgs(DEAD_ADDRESS);

      expect(await deployer.vBase.sequencerUptimeFeed()).to.not.eq(
        initialSequencerUptimeFeed
      );
      await expect(
        deployer.vBase.setSequencerUptimeFeed(initialSequencerUptimeFeed)
      )
        .to.emit(deployer.vBase, 'SequencerUptimeFeedUpdated')
        .withArgs(initialSequencerUptimeFeed);

      expect(await deployer.vBase.sequencerUptimeFeed()).to.eq(
        initialSequencerUptimeFeed
      );
    });

    it('Should fail to set new grace period if not governance address', async () => {
      await expect(
        user.vBase.setGracePeriod(VALID_GRACE_PERIOD)
      ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));
    });

    it('Should fail to set new grace period if not within bounds', async () => {
      const gracePeriodTooLow = 59;
      await expect(
        deployer.vBase.setGracePeriod(gracePeriodTooLow)
      ).to.be.revertedWith(VBaseErrors.IncorrectGracePeriod);

      const gracePeriodTooHigh = 3601;
      await expect(
        deployer.vBase.setGracePeriod(gracePeriodTooHigh)
      ).to.be.revertedWith(VBaseErrors.IncorrectGracePeriod);
    });

    it('Should work to set new valid grace period', async () => {
      expect(await deployer.vBase.gracePeriod()).to.not.eq(VALID_GRACE_PERIOD);

      await expect(deployer.vBase.setGracePeriod(VALID_GRACE_PERIOD))
        .to.emit(deployer.vBase, 'GracePeriodUpdated')
        .withArgs(VALID_GRACE_PERIOD);

      expect(await deployer.vBase.gracePeriod()).to.eq(VALID_GRACE_PERIOD);
    });
  });

  describe('Pause', function () {
    describe('Pause ClearingHouse', function () {
      it('User should not be able to pause ', async function () {
        await expect(user.clearingHouse.pause()).to.be.revertedWith(
          AccessControlErrors.revertManager(user.address)
        );
      });

      it('Deployer should be able to pause ', async function () {
        await expect(deployer.clearingHouse.pause())
          .to.emit(deployer.clearingHouse, 'Paused')
          .withArgs(deployer.address);
      });

      it('User should not be able to unpause ', async function () {
        await expect(deployer.clearingHouse.pause());

        await expect(user.clearingHouse.unpause()).to.be.revertedWith(
          AccessControlErrors.revertManager(user.address)
        );
      });

      it('Deployer should able to unpause ', async function () {
        await expect(deployer.clearingHouse.pause());

        await expect(deployer.clearingHouse.unpause())
          .to.emit(deployer.clearingHouse, 'Unpaused')
          .withArgs(deployer.address);
      });

      it('No deposit/withdrawal/trading/liquidity/liquidation possible when paused ', async function () {
        await expect(deployer.clearingHouse.pause());

        await expect(
          user.clearingHouse.deposit(1, user.ua.address)
        ).to.be.revertedWith('Pausable: paused');
        await expect(
          user.clearingHouse.withdraw(1, user.ua.address)
        ).to.be.revertedWith('Pausable: paused');

        await expect(
          user.clearingHouse.changePosition(0, 1, 1, 0)
        ).to.be.revertedWith('Pausable: paused');
        await expect(
          user.clearingHouse.extendPositionWithCollateral(
            0,
            1,
            user.ua.address,
            0,
            0,
            1
          )
        ).to.be.revertedWith('Pausable: paused');

        await expect(
          user.clearingHouse.provideLiquidity(0, [1, 1], 0)
        ).to.be.revertedWith('Pausable: paused');
        await expect(
          user.clearingHouse.removeLiquidity(0, 1, [0, 0], 0, 0)
        ).to.be.revertedWith('Pausable: paused');

        await expect(
          user.clearingHouse.liquidate(0, user.address, 1, true)
        ).to.be.revertedWith('Pausable: paused');
      });
    });

    describe('Pause Perpetual', function () {
      it('User should not be able to pause', async function () {
        await expect(user.perpetual.pause()).to.be.revertedWith(
          AccessControlErrors.revertManager(user.address)
        );
      });

      it('Deployer should be able to pause ', async function () {
        await expect(deployer.perpetual.pause())
          .to.emit(deployer.perpetual, 'Paused')
          .withArgs(deployer.address);
      });

      it('User should not be able to unpause ', async function () {
        await expect(deployer.perpetual.pause());

        await expect(user.perpetual.unpause()).to.be.revertedWith(
          AccessControlErrors.revertManager(user.address)
        );
      });

      it('Deployer should able to unpause ', async function () {
        await expect(deployer.perpetual.pause());

        await expect(deployer.perpetual.unpause())
          .to.emit(deployer.perpetual, 'Unpaused')
          .withArgs(deployer.address);
      });

      it('No deposit/withdrawal/trading/liquidity/liquidation possible when paused ', async function () {
        await expect(deployer.perpetual.pause());

        await expect(
          user.perpetual.changePosition(user.address, 1, 1, 0, false)
        ).to.be.revertedWith('Pausable: paused');

        await expect(
          user.perpetual.provideLiquidity(user.address, [0, 0], 1)
        ).to.be.revertedWith('Pausable: paused');

        await expect(
          user.perpetual.removeLiquidity(user.address, 1, [0, 0], 0, 0, false)
        ).to.be.revertedWith('Pausable: paused');
      });
    });
  });

  describe('Dust', function () {
    it('Owner can withdraw dust', async function () {
      // provide initial liquidity
      const liquidityAmount = await createUABalance([lp]);
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      // generate some dust
      const dustAmount = liquidityAmount.div(200);
      await user.perpetual.__TestPerpetual_setTraderPosition(
        user.clearingHouse.address,
        0,
        dustAmount,
        (
          await lp.perpetual.getGlobalPosition()
        ).cumFundingRate
      );

      expect(
        (await user.perpetual.getTraderPosition(user.clearingHouse.address))
          .positionSize
      ).to.eq(dustAmount);

      // withdraw dust
      const {quoteProceeds, percentageFee} =
        await getProceedsFromClosingLongPosition(
          user.market,
          user.curveViews,
          dustAmount
        );
      const eProfit = quoteProceeds.sub(
        rMul(quoteProceeds.abs(), percentageFee)
      );

      const insuranceBalanceBefore = await user.ua.balanceOf(
        user.insurance.address
      );

      await expect(deployer.clearingHouse.sellDust(0, dustAmount, 0))
        .to.emit(user.clearingHouse, 'DustSold')
        .withArgs(0, eProfit);

      expect(await user.ua.balanceOf(user.insurance.address)).to.eq(
        insuranceBalanceBefore.add(eProfit)
      );
    });
  });

  describe('Change ClearingHouse parameters', function () {
    const validMinMargin = asBigNumber('0.1');
    const validMinMarginAtCreation = asBigNumber('0.2');
    const validProposedMinPositiveOpenNotional = asBigNumber('50');
    const validLiquidationReward = asBigNumber('0.02');
    const validInsuranceRatio = asBigNumber('0.2');
    const validLiquidationRewardInsuranceShare = asBigNumber('0.3');
    const validLiquidationDiscount = asBigNumber('0.98');
    const validNonUACollSeizureDiscount = asBigNumber('0.5');
    const validUaDebtSeizureThreshold = asBigNumber('5000');

    it('User should not be able to update ClearingHouse parameters', async function () {
      const params: IClearingHouse.ClearingHouseParamsStruct = {
        minMargin: 0,
        minMarginAtCreation: 0,
        minPositiveOpenNotional: 0,
        liquidationReward: 0,
        insuranceRatio: 0,
        liquidationRewardInsuranceShare: 0,
        liquidationDiscount: 0,
        nonUACollSeizureDiscount: 0,
        uaDebtSeizureThreshold: 0,
      };

      await expect(user.clearingHouse.setParameters(params)).to.be.revertedWith(
        AccessControlErrors.revertGovernance(user.address)
      );
    });

    it('Owner should be able to update minMargin when within the bounds', async function () {
      const minMarginTooLow = asBigNumber('0.02').sub(1);
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: minMarginTooLow,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(ClearingHouseErrors.InvalidMinMargin);

      const minMarginTooHigh = asBigNumber('0.3').add(1);
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: minMarginTooHigh,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(ClearingHouseErrors.InvalidMinMargin);

      const currentMinMarginAtCreation =
        await deployer.clearingHouse.minMarginAtCreation();
      const minMarginGtMinMarginAtCreation = currentMinMarginAtCreation.add(1);
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: minMarginGtMinMarginAtCreation,
          minMarginAtCreation: currentMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(ClearingHouseErrors.InvalidMinMarginAtCreation);

      const initialMinMargin = await deployer.clearingHouse.minMargin();
      const newProposedMinMargin = validMinMargin;
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: newProposedMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      )
        .to.emit(deployer.clearingHouse, 'ClearingHouseParametersChanged')
        .withArgs(
          newProposedMinMargin,
          validMinMarginAtCreation,
          validProposedMinPositiveOpenNotional,
          validLiquidationReward,
          validInsuranceRatio,
          validLiquidationRewardInsuranceShare,
          validLiquidationDiscount,
          validNonUACollSeizureDiscount,
          validUaDebtSeizureThreshold
        );
      const newActualMinMargin = await deployer.clearingHouse.minMargin();
      expect(newActualMinMargin).to.not.eq(initialMinMargin);
      expect(newActualMinMargin).to.eq(newProposedMinMargin);
    });

    it('Owner should be able to update minMarginAtCreation when within the bounds', async function () {
      const minMarginAtCreationTooLow =
        await deployer.clearingHouse.minMargin();
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: minMarginAtCreationTooLow,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(ClearingHouseErrors.InvalidMinMarginAtCreation);

      const minMarginAtCreationTooHigh = asBigNumber('0.5').add(1);
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: minMarginAtCreationTooHigh,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(ClearingHouseErrors.InvalidMinMarginAtCreation);

      const initialMinMarginAtCreation =
        await deployer.clearingHouse.minMarginAtCreation();
      const newProposedMinMarginAtCreation = validMinMarginAtCreation;
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: newProposedMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      )
        .to.emit(deployer.clearingHouse, 'ClearingHouseParametersChanged')
        .withArgs(
          validMinMargin,
          newProposedMinMarginAtCreation,
          validProposedMinPositiveOpenNotional,
          validLiquidationReward,
          validInsuranceRatio,
          validLiquidationRewardInsuranceShare,
          validLiquidationDiscount,
          validNonUACollSeizureDiscount,
          validUaDebtSeizureThreshold
        );

      const newActualMinMarginAtCreation =
        await deployer.clearingHouse.minMarginAtCreation();
      expect(newActualMinMarginAtCreation).to.not.eq(
        initialMinMarginAtCreation
      );
      expect(newActualMinMarginAtCreation).to.eq(
        newProposedMinMarginAtCreation
      );
    });

    it('Owner should be able to update minPositiveOpenNotional', async function () {
      const initialMinPositiveOpenNotional =
        await deployer.clearingHouse.minPositiveOpenNotional();

      const newProposedMinPositiveOpenNotional =
        validProposedMinPositiveOpenNotional;
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: newProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      )
        .to.emit(deployer.clearingHouse, 'ClearingHouseParametersChanged')
        .withArgs(
          validMinMargin,
          validMinMarginAtCreation,
          newProposedMinPositiveOpenNotional,
          validLiquidationReward,
          validInsuranceRatio,
          validLiquidationRewardInsuranceShare,
          validLiquidationDiscount,
          validNonUACollSeizureDiscount,
          validUaDebtSeizureThreshold
        );

      const newMinPositiveOpenNotional =
        await deployer.clearingHouse.minPositiveOpenNotional();
      expect(newMinPositiveOpenNotional).to.not.eq(
        initialMinPositiveOpenNotional
      );
      expect(newMinPositiveOpenNotional).to.eq(
        newProposedMinPositiveOpenNotional
      );
    });

    it('Owner should be able to update liquidationReward when within the bounds', async function () {
      const liquidationRewardTooLow = asBigNumber('0.01').sub(1);
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: liquidationRewardTooLow,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(ClearingHouseErrors.InvalidLiquidationReward);

      const currentMinMargin = await deployer.clearingHouse.minMargin();
      const liquidationRewardTooHigh = currentMinMargin;
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: currentMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: liquidationRewardTooHigh,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(ClearingHouseErrors.InvalidLiquidationReward);

      const initialLiquidationReward =
        await deployer.clearingHouse.liquidationReward();

      const newProposedLiquidationReward = validLiquidationReward;
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: newProposedLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      )
        .to.emit(deployer.clearingHouse, 'ClearingHouseParametersChanged')
        .withArgs(
          validMinMargin,
          validMinMarginAtCreation,
          validProposedMinPositiveOpenNotional,
          newProposedLiquidationReward,
          validInsuranceRatio,
          validLiquidationRewardInsuranceShare,
          validLiquidationDiscount,
          validNonUACollSeizureDiscount,
          validUaDebtSeizureThreshold
        );

      const newActualLiquidationReward =
        await deployer.clearingHouse.liquidationReward();
      expect(newActualLiquidationReward).to.not.eq(initialLiquidationReward);
      expect(newActualLiquidationReward).to.eq(newProposedLiquidationReward);
    });

    it('Owner should be able to update insuranceRatio when within the bounds', async function () {
      const insuranceRatioTooLow = asBigNumber('0.1').sub(1);
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: insuranceRatioTooLow,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(ClearingHouseErrors.InvalidInsuranceRatio);

      const insuranceRatioTooHigh = asBigNumber('0.5').add(1);
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: insuranceRatioTooHigh,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(ClearingHouseErrors.InvalidInsuranceRatio);

      const initialInsuranceRatio =
        await deployer.clearingHouse.insuranceRatio();

      const newProposedInsuranceRatio = validInsuranceRatio;
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: newProposedInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      )
        .to.emit(deployer.clearingHouse, 'ClearingHouseParametersChanged')
        .withArgs(
          validMinMargin,
          validMinMarginAtCreation,
          validProposedMinPositiveOpenNotional,
          validLiquidationReward,
          newProposedInsuranceRatio,
          validLiquidationRewardInsuranceShare,
          validLiquidationDiscount,
          validNonUACollSeizureDiscount,
          validUaDebtSeizureThreshold
        );

      const newActualInsuranceRatio =
        await deployer.clearingHouse.insuranceRatio();
      expect(newActualInsuranceRatio).to.not.eq(initialInsuranceRatio);
      expect(newActualInsuranceRatio).to.eq(newProposedInsuranceRatio);
    });

    it('Owner should be able to update validLiquidationRewardInsuranceShare', async function () {
      const liquidationRewardInsuranceShareTooHigh = asBigNumber('1').add(1);
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare:
            liquidationRewardInsuranceShareTooHigh,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(
        ClearingHouseErrors.ExcessiveLiquidationRewardInsuranceShare
      );

      const initialValidLiquidationRewardInsuranceShare =
        await deployer.clearingHouse.liquidationRewardInsuranceShare();

      const newProposedLiquidationRewardInsuranceShare = asBigNumber('0.5');
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare:
            newProposedLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      )
        .to.emit(deployer.clearingHouse, 'ClearingHouseParametersChanged')
        .withArgs(
          validMinMargin,
          validMinMarginAtCreation,
          validProposedMinPositiveOpenNotional,
          validLiquidationReward,
          validInsuranceRatio,
          newProposedLiquidationRewardInsuranceShare,
          validLiquidationDiscount,
          validNonUACollSeizureDiscount,
          validUaDebtSeizureThreshold
        );

      const newLiquidationRewardInsuranceShare =
        await deployer.clearingHouse.liquidationRewardInsuranceShare();
      expect(newLiquidationRewardInsuranceShare).to.not.eq(
        initialValidLiquidationRewardInsuranceShare
      );
      expect(newLiquidationRewardInsuranceShare).to.eq(
        newProposedLiquidationRewardInsuranceShare
      );
    });

    it('Owner should be able to update liquidationDiscount and nonUACollSeizureDiscount when conditions met', async function () {
      const initialLiquidationDiscount =
        await deployer.clearingHouse.liquidationDiscount();
      const initialNonUACollSeizureDiscount =
        await deployer.clearingHouse.nonUACollSeizureDiscount();

      const excessiveNewNonUACollSeizureDiscount = initialLiquidationDiscount
        .sub(asBigNumber('0.1'))
        .add(1);
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: initialLiquidationDiscount,
          nonUACollSeizureDiscount: excessiveNewNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(
        ClearingHouseErrors.InsufficientDiffBtwLiquidationDiscountAndNonUACollSeizureDiscount
      );

      const insufficientNewLiquidationDiscount = initialNonUACollSeizureDiscount
        .add(asBigNumber('0.1'))
        .sub(1);
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: insufficientNewLiquidationDiscount,
          nonUACollSeizureDiscount: initialNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      ).to.be.revertedWith(
        ClearingHouseErrors.InsufficientDiffBtwLiquidationDiscountAndNonUACollSeizureDiscount
      );

      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      )
        .to.emit(deployer.clearingHouse, 'ClearingHouseParametersChanged')
        .withArgs(
          validMinMargin,
          validMinMarginAtCreation,
          validProposedMinPositiveOpenNotional,
          validLiquidationReward,
          validInsuranceRatio,
          validLiquidationRewardInsuranceShare,
          validLiquidationDiscount,
          validNonUACollSeizureDiscount,
          validUaDebtSeizureThreshold
        );

      const newLiquidationDiscount =
        await deployer.clearingHouse.liquidationDiscount();
      expect(newLiquidationDiscount).to.not.eq(initialLiquidationDiscount);
      expect(newLiquidationDiscount).to.eq(validLiquidationDiscount);

      const newNonUACollSeizureDiscount =
        await deployer.clearingHouse.nonUACollSeizureDiscount();
      expect(newNonUACollSeizureDiscount).to.not.eq(
        initialNonUACollSeizureDiscount
      );
      expect(newNonUACollSeizureDiscount).to.eq(validNonUACollSeizureDiscount);
    });

    it('Owner should be able to update newUaDebtSeizureThreshold', async function () {
      const newUaDebtSeizureThresholdTooLow = asBigNumber('99');
      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationReward,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: newUaDebtSeizureThresholdTooLow,
        })
      ).to.be.revertedWith(
        ClearingHouseErrors.InsufficientUaDebtSeizureThreshold
      );

      const initialUaDebtSeizureThreshold =
        await deployer.clearingHouse.uaDebtSeizureThreshold();

      await expect(
        deployer.clearingHouse.setParameters({
          minMargin: validMinMargin,
          minMarginAtCreation: validMinMarginAtCreation,
          minPositiveOpenNotional: validProposedMinPositiveOpenNotional,
          liquidationReward: validLiquidationReward,
          insuranceRatio: validInsuranceRatio,
          liquidationRewardInsuranceShare: validLiquidationRewardInsuranceShare,
          liquidationDiscount: validLiquidationDiscount,
          nonUACollSeizureDiscount: validNonUACollSeizureDiscount,
          uaDebtSeizureThreshold: validUaDebtSeizureThreshold,
        })
      )
        .to.emit(deployer.clearingHouse, 'ClearingHouseParametersChanged')
        .withArgs(
          validMinMargin,
          validMinMarginAtCreation,
          validProposedMinPositiveOpenNotional,
          validLiquidationReward,
          validInsuranceRatio,
          validLiquidationRewardInsuranceShare,
          validLiquidationDiscount,
          validNonUACollSeizureDiscount,
          validUaDebtSeizureThreshold
        );

      const newUaDebtSeizureThreshold =
        await deployer.clearingHouse.uaDebtSeizureThreshold();

      expect(newUaDebtSeizureThreshold).to.not.eq(
        initialUaDebtSeizureThreshold
      );
      expect(newUaDebtSeizureThreshold).to.eq(validUaDebtSeizureThreshold);
    });
  });

  describe('Change Perpetual parameters', function () {
    const validWeight = asBigNumber('2');
    const validMaxLiquidityProvided = asBigNumber('1000000');
    const validTwapFrequency = minutes(16);
    const validSensitivity = asBigNumber('1');
    const validMaxBlockTradeAmount = asBigNumber('1000');
    const validFee = asBigNumber('0.001').add(135);
    const validLpDebtCoef = asBigNumber('5');
    const validLockPeriod = days(11);

    const feeTooLow = asBigNumber('0.0001').sub(1);
    const feeTooHigh = asBigNumber('0.01').add(1);
    const twapFrequencyTooHigh = days(1);
    const twapFrequencyTooLow = 40;
    const maxBlockTradeAmountTooLow = asBigNumber('1');
    const sensitivityTooHigh = asBigNumber('100');
    const sensitivityTooLow = asBigNumber('0.0001');
    const lpDebtCoefTooHigh = asBigNumber('25');
    const lpDebtCoefTooLow = asBigNumber('0.5');
    const lockPeriodTooLow = minutes(1);
    const lockPeriodTooHigh = days(365);
    const riskWeightTooHigh = asBigNumber('100');
    const riskWeightTooLow = asBigNumber('0.99');

    it('User should not be able to change Perpetual parameters', async function () {
      const params: IPerpetual.PerpetualParamsStruct = {
        riskWeight: validWeight,
        maxLiquidityProvided: validMaxLiquidityProvided,
        twapFrequency: validTwapFrequency,
        sensitivity: validSensitivity,
        maxBlockTradeAmount: validMaxBlockTradeAmount,
        insuranceFee: validFee,
        lpDebtCoef: validLpDebtCoef,
        lockPeriod: validLockPeriod,
      };

      await expect(user.perpetual.setParameters(params)).to.be.revertedWith(
        AccessControlErrors.revertGovernance(user.address)
      );
    });

    it('Contract owner should not be able to change the fees if they are outside of the bounds', async function () {
      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: feeTooLow,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: validLockPeriod,
        })
      ).to.be.revertedWith(PerpetualErrors.InsuranceFeeInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: feeTooHigh,
          lpDebtCoef: validLpDebtCoef,

          lockPeriod: validLockPeriod,
        })
      ).to.be.revertedWith(PerpetualErrors.InsuranceFeeInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: twapFrequencyTooHigh,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,

          lockPeriod: validLockPeriod,
        })
      ).to.be.revertedWith(PerpetualErrors.TwapFrequencyInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: twapFrequencyTooLow,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,

          lockPeriod: validLockPeriod,
        })
      ).to.be.revertedWith(PerpetualErrors.TwapFrequencyInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: maxBlockTradeAmountTooLow,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,

          lockPeriod: validLockPeriod,
        })
      ).to.be.revertedWith(PerpetualErrors.MaxBlockAmountInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: sensitivityTooHigh,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: validLockPeriod,
        })
      ).to.be.revertedWith(PerpetualErrors.SensitivityInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: sensitivityTooLow,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,

          lockPeriod: validLockPeriod,
        })
      ).to.be.revertedWith(PerpetualErrors.SensitivityInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: lpDebtCoefTooLow,
          lockPeriod: validLockPeriod,
        })
      ).to.be.revertedWith(PerpetualErrors.LpDebtCoefInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: lpDebtCoefTooHigh,
          lockPeriod: validLockPeriod,
        })
      ).to.be.revertedWith(PerpetualErrors.LpDebtCoefInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: lockPeriodTooHigh,
        })
      ).to.be.revertedWith(PerpetualErrors.LockPeriodInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: lockPeriodTooLow,
        })
      ).to.be.revertedWith(PerpetualErrors.LockPeriodInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: riskWeightTooHigh,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: validLockPeriod,
        })
      ).to.be.revertedWith(PerpetualErrors.RiskWeightInvalid);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: riskWeightTooLow,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: validLockPeriod,
        })
      ).to.be.revertedWith(PerpetualErrors.RiskWeightInvalid);
    });

    it('Contract owner should be able to change Perpetual newTwapFrequency', async function () {
      const initialSensitivity = await deployer.perpetual.twapFrequency();
      const newTwapFrequency = minutes(16);

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: newTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: validLockPeriod,
        })
      )
        .to.emit(deployer.perpetual, 'PerpetualParametersChanged')
        .withArgs(
          validWeight,
          validMaxLiquidityProvided,
          newTwapFrequency,
          validSensitivity,
          validMaxBlockTradeAmount,
          validFee,
          validLpDebtCoef,
          validLockPeriod
        );

      const actualNewSensitivity = await deployer.perpetual.twapFrequency();
      expect(actualNewSensitivity).to.not.eq(initialSensitivity);
      expect(actualNewSensitivity).to.eq(newTwapFrequency);
    });

    it('Contract owner should be able to change Perpetual newSensitivity', async function () {
      const initialSensitivity = await deployer.perpetual.sensitivity();
      const newSensitivity = asBigNumber('3');

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: newSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: validLockPeriod,
        })
      )
        .to.emit(deployer.perpetual, 'PerpetualParametersChanged')
        .withArgs(
          validWeight,
          validMaxLiquidityProvided,
          validTwapFrequency,
          newSensitivity,
          validMaxBlockTradeAmount,
          validFee,
          validLpDebtCoef,
          validLockPeriod
        );

      const actualNewSensitivity = await deployer.perpetual.sensitivity();
      expect(actualNewSensitivity).to.not.eq(initialSensitivity);
      expect(actualNewSensitivity).to.eq(newSensitivity);
    });

    it('Contract owner should be able to change Perpetual newMaxBlockTradeAmount', async function () {
      const initialMaxBlockTradeAmount =
        await deployer.perpetual.maxBlockTradeAmount();
      const newMaxBlockTradeAmount = asBigNumber('1000');

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: newMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: validLockPeriod,
        })
      )
        .to.emit(deployer.perpetual, 'PerpetualParametersChanged')
        .withArgs(
          validWeight,
          validMaxLiquidityProvided,
          validTwapFrequency,
          validSensitivity,
          newMaxBlockTradeAmount,
          validFee,
          validLpDebtCoef,
          validLockPeriod
        );

      const actualNewMaxBlockTradeAmount =
        await deployer.perpetual.maxBlockTradeAmount();
      expect(actualNewMaxBlockTradeAmount).to.not.eq(
        initialMaxBlockTradeAmount
      );
      expect(actualNewMaxBlockTradeAmount).to.eq(newMaxBlockTradeAmount);
    });

    it('Contract owner should be able to change the fees if the new value is inside the defined bounds', async function () {
      const initialInsuranceFee = await deployer.perpetual.insuranceFee();

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: validLockPeriod,
        })
      )
        .to.emit(deployer.perpetual, 'PerpetualParametersChanged')
        .withArgs(
          validWeight,
          validMaxLiquidityProvided,
          validTwapFrequency,
          validSensitivity,
          validMaxBlockTradeAmount,
          validFee,
          validLpDebtCoef,
          validLockPeriod
        );

      const newActualInsuranceFee = await deployer.perpetual.insuranceFee();
      expect(newActualInsuranceFee).to.not.eq(initialInsuranceFee);
      expect(newActualInsuranceFee).to.eq(validFee);
    });

    it('Contract owner should be able to change the lpDebtCoef if the new value is inside the defined bounds', async function () {
      const initialLpDebtCoef = await deployer.perpetual.lpDebtCoef();

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: validLockPeriod,
        })
      )
        .to.emit(deployer.perpetual, 'PerpetualParametersChanged')
        .withArgs(
          validWeight,
          validMaxLiquidityProvided,
          validTwapFrequency,
          validSensitivity,
          validMaxBlockTradeAmount,
          validFee,
          validLpDebtCoef,
          validLockPeriod
        );

      const newActualLpDebtCoef = await deployer.perpetual.lpDebtCoef();
      expect(newActualLpDebtCoef).to.not.eq(initialLpDebtCoef);
      expect(newActualLpDebtCoef).to.eq(validLpDebtCoef);
    });
    it('Contract owner should be able to change the lock period if the new value is inside the defined bounds', async function () {
      const lockPeriod = await deployer.perpetual.lockPeriod();

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: validLockPeriod,
        })
      )
        .to.emit(deployer.perpetual, 'PerpetualParametersChanged')
        .withArgs(
          validWeight,
          validMaxLiquidityProvided,
          validTwapFrequency,
          validSensitivity,
          validMaxBlockTradeAmount,
          validFee,
          validLpDebtCoef,
          validLockPeriod
        );

      const newActualLockPeriod = await deployer.perpetual.lockPeriod();
      expect(newActualLockPeriod).to.not.eq(lockPeriod);
      expect(newActualLockPeriod).to.eq(validLockPeriod);
    });

    it('Contract owner should be able to change the risk weight if the new value is inside the defined bounds', async function () {
      const riskWeight = await deployer.perpetual.riskWeight();

      await expect(
        deployer.perpetual.setParameters({
          riskWeight: validWeight,
          maxLiquidityProvided: validMaxLiquidityProvided,
          twapFrequency: validTwapFrequency,
          sensitivity: validSensitivity,
          maxBlockTradeAmount: validMaxBlockTradeAmount,
          insuranceFee: validFee,
          lpDebtCoef: validLpDebtCoef,
          lockPeriod: validLockPeriod,
        })
      )
        .to.emit(deployer.perpetual, 'PerpetualParametersChanged')
        .withArgs(
          validWeight,
          validMaxLiquidityProvided,
          validTwapFrequency,
          validSensitivity,
          validMaxBlockTradeAmount,
          validFee,
          validLpDebtCoef,
          validLockPeriod
        );

      const newActualRiskWeight = await deployer.perpetual.riskWeight();
      expect(newActualRiskWeight).to.not.eq(riskWeight);
      expect(newActualRiskWeight).to.eq(validWeight);
    });
  });
});
