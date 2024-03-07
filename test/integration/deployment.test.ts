import {expect} from 'chai';
import env = require('hardhat');

import {setup} from '../helpers/setup';
import {
  getCryptoSwapConfigs,
  getPerpetualConfigs,
} from '../../helpers/contracts-deployments';
import {getChainlinkPrice} from '../../helpers/contracts-getters';
import {ethers} from 'hardhat';
import {PerpetualErrors} from '../../helpers/errors';
import {VBASE_INDEX, VQUOTE_INDEX} from '../../helpers/constants';

describe('Increment Protocol: Deployment', function () {
  describe('Deployment', function () {
    it('Should initialize Vault with its dependencies ', async function () {
      const {deployer} = await setup();

      expect(await deployer.vault.isGovernor(deployer.address)).to.be.true;
      expect(await deployer.vault.UA()).to.be.equal(deployer.ua.address);
      expect(await deployer.vault.getTotalValueLocked()).to.be.equal(0);
    });
  });
  it('Should deploy Insurance with correct parameters', async function () {
    const {deployer} = await setup();

    expect(await deployer.insurance.token()).to.be.equal(deployer.ua.address);
    expect(await deployer.insurance.vault()).to.be.equal(
      deployer.vault.address
    );
    expect(await deployer.insurance.isGovernor(deployer.address)).to.be.true;
  });
  it('Should initialize ClearingHouse with its dependencies', async function () {
    const {deployer} = await setup();

    expect(await deployer.clearingHouse.isGovernor(deployer.address)).to.be
      .true;
    expect(await deployer.clearingHouse.perpetuals(0)).to.be.equal(
      deployer.perpetual.address
    );
    expect(await deployer.clearingHouse.vault()).to.be.equal(
      deployer.vault.address
    );
  });
  it('Should initialize Perpetual with its dependencies', async function () {
    const {deployer} = await setup();

    expect(await deployer.perpetual.market()).to.equal(deployer.market.address);
    expect(await deployer.perpetual.vBase()).to.equal(deployer.vBase.address);
    expect(await deployer.perpetual.vQuote()).to.equal(deployer.vQuote.address);
    expect(await deployer.perpetual.clearingHouse()).to.equal(
      deployer.clearingHouse.address
    );
  });
  it('Should initialize vBase and vQuote with Perpetual as their perp owner', async function () {
    const {deployer} = await setup();

    expect(await deployer.vBase.perp()).to.be.equal(deployer.perpetual.address);
    expect(await deployer.vBase.isManager(deployer.address)).to.be.true;
    expect(await deployer.vBase.symbol()).to.be.equal('vEUR');

    // unlike vBase, vQuote has no governance owner because there's no parameter to be changed in this token
    expect(await deployer.vQuote.perp()).to.be.equal(
      deployer.perpetual.address
    );
    expect(await deployer.vQuote.symbol()).to.be.equal('vUSD');
  });
  it('Should initialize CurveSwap with correct parameters', async function () {
    const {deployer} = await setup();

    // change depending on pair you want to deploy
    const initialPrice = await getChainlinkPrice(env, 'EUR_USD');
    const args = getCryptoSwapConfigs('EUR_USD');

    // coins
    expect(await deployer.curveToken.minter()).to.be.equal(
      deployer.market.address
    );
    expect(await deployer.market.token()).to.be.equal(
      deployer.curveToken.address
    );

    // constructor parameters
    expect(await deployer.market.A()).to.be.equal(args.A);
    expect(await deployer.market.gamma()).to.be.equal(args.gamma);

    expect(await deployer.market.mid_fee()).to.be.equal(args.mid_fee);
    expect(await deployer.market.out_fee()).to.be.equal(args.out_fee);
    expect(await deployer.market.allowed_extra_profit()).to.be.equal(
      args.allowed_extra_profit
    );
    expect(await deployer.market.fee_gamma()).to.be.equal(args.fee_gamma);
    expect(await deployer.market.adjustment_step()).to.be.equal(
      args.adjustment_step
    );
    expect(await deployer.market.admin_fee()).to.be.equal(args.admin_fee);
    expect(await deployer.market.ma_half_time()).to.be.equal(args.ma_half_time);

    expect(await deployer.market.price_scale()).to.be.equal(initialPrice);
    expect(await deployer.market.price_oracle()).to.be.equal(initialPrice);
    expect(await deployer.market.last_prices()).to.be.equal(initialPrice);
  });
  it('Should fail deployment when ERC20 approve call fails ', async function () {
    const {deployer} = await setup();

    const factoryErc20 = await ethers.getContractFactory(
      'TestErc20ApproveReturnFalse'
    );
    const failingErc20 = await factoryErc20.deploy();
    const factory = await ethers.getContractFactory('TestPerpetual');

    const config = getPerpetualConfigs('EUR_USD');

    await expect(
      factory.deploy(
        failingErc20.address,
        deployer.vQuote.address,
        deployer.market.address,
        deployer.clearingHouse.address,
        deployer.curveViews.address,
        config
      )
    ).to.be.revertedWith(
      PerpetualErrors.VirtualTokenApprovalConstructor + '(' + VBASE_INDEX + ')'
    );

    await expect(
      factory.deploy(
        deployer.vBase.address,
        failingErc20.address,
        deployer.market.address,
        deployer.clearingHouse.address,
        deployer.curveViews.address,
        config
      )
    ).to.be.revertedWith(
      PerpetualErrors.VirtualTokenApprovalConstructor + '(' + VQUOTE_INDEX + ')'
    );
  });
});
