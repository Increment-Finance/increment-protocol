import {expect} from 'chai';
import {ethers, deployments, getNamedAccounts} from 'hardhat';
import env = require('hardhat');

// typechain objects
import {
  CurveTokenV5Test,
  CurveCryptoSwapTest,
  CurveCryptoSwap2ETH,
  CurveMath__factory,
  CurveCryptoViews__factory,
  CurveMath,
  CurveCryptoViews,
} from '../../typechain';
import {VBase, VQuote, VirtualToken} from '../../typechain';

// utils
import {asBigNumber, rDiv} from '../helpers/utils/calculations';
import {MAX_UINT_AMOUNT} from '../../helpers/constants';
import {
  TEST_get_dy,
  TEST_get_remove_liquidity,
  TEST_dust_remove_liquidity,
  TEST_get_exactOutputSwapExFees,
} from '../helpers/CurveUtils';
import {getCryptoSwapConfigs} from '../../helpers/contracts-deployments';
import {
  setNextBlockTimestampWithArg,
  setupUser,
} from '../../helpers/misc-utils';
import {tEthereumAddress, BigNumber} from '../../helpers/types';

import {VirtualToken__factory} from '../../typechain';
import {
  CurveCryptoSwap2ETH__factory,
  CurveCryptoSwapTest__factory,
  CurveTokenV5Test__factory,
} from '../../typechain';
import {takeOverAndFundAccount} from '../helpers/AccountUtils';

type User = {address: string} & {
  vBase: VBase;
  vQuote: VQuote;
  market: CurveCryptoSwapTest;
  market2: CurveCryptoSwap2ETH;
  curveToken: CurveTokenV5Test;
  math: CurveMath;
  curveViews: CurveCryptoViews;
};

interface TestEnv {
  deployer: User;
  trader: User;
  lp: User;
  lpTwo: User;
  marketA: tEthereumAddress;
  vBaseA: tEthereumAddress;
  vQuoteA: tEthereumAddress;
  curveTokenA: tEthereumAddress;
  mathA: tEthereumAddress;
  curveViewsA: tEthereumAddress;
}

// fixed initial price
const initialPrice = ethers.utils.parseEther('1.131523');

// setup function w/ snapshots
const setup = deployments.createFixture(async (): Promise<TestEnv> => {
  const {lp, lpTwo, trader, deployer} = await getNamedAccounts();
  console.log(`Current network is ${env.network.name.toString()}`);

  const [DEPLOYER] = await ethers.getSigners();
  // deploy vBase & vQuote
  const VBaseFactory = new VirtualToken__factory(DEPLOYER);
  const vBase = await VBaseFactory.deploy('Long EUR/USD', 'vBase');

  const VQuoteFactory = new VirtualToken__factory(DEPLOYER);
  const vQuote = await VQuoteFactory.deploy('Short EUR/USD', 'vQuote');

  // deploy curve token
  const CurveTokenV5Factory = new CurveTokenV5Test__factory(DEPLOYER);
  const curveToken = await CurveTokenV5Factory.deploy('vBase/vQuote', 'EURUSD');

  // deploy curve pool
  const FundingFactory = new CurveCryptoSwapTest__factory(DEPLOYER);

  console.log(
    'Use FIXED EUR/USD price of ',
    env.ethers.utils.formatEther(initialPrice)
  );
  // deploy CryptoSwap
  const cryptoSwapConfigs = getCryptoSwapConfigs('EUR_USD');

  const cryptoSwap = await FundingFactory.deploy(
    deployer,
    '0xeCb456EA5365865EbAb8a2661B0c503410e9B347', // from: https://github.com/curvefi/curve-crypto-contract/blob/f66b0c7b33232b431a813b9201e47a35c70db1ab/scripts/deploy_mainnet_eurs_pool.py#L18
    cryptoSwapConfigs.A,
    cryptoSwapConfigs.gamma,
    cryptoSwapConfigs.mid_fee,
    cryptoSwapConfigs.out_fee,
    cryptoSwapConfigs.allowed_extra_profit,
    cryptoSwapConfigs.fee_gamma,
    cryptoSwapConfigs.adjustment_step,
    cryptoSwapConfigs.admin_fee,
    cryptoSwapConfigs.ma_half_time,
    initialPrice,
    curveToken.address,
    [vQuote.address, vBase.address]
  );

  // transfer minter role to curve pool
  await curveToken.set_minter(cryptoSwap.address);

  console.log('We have deployed vBase/vQuote curve pool');

  // Initiate a CurveCryptoSwap2ETH object around the cryptoSwap contract
  // needed since some functions (i.e. TEST_dust_remove_liquidity(), TEST_get_exactOutputSwap()),
  // require the CurveCryptoSwap2ETH contract
  const crytoSwapFactory = new CurveCryptoSwap2ETH__factory(DEPLOYER);
  const marketAsCurveCryptoSwap2ETH = crytoSwapFactory.attach(
    cryptoSwap.address
  );

  // deploy math contract
  const MathFactory = new CurveMath__factory(DEPLOYER);
  const math = await MathFactory.deploy();

  // deploy views contract
  const CurveViewsFactory = new CurveCryptoViews__factory(DEPLOYER);
  const curveViews = await CurveViewsFactory.deploy(math.address);

  const contracts = {
    vBase: <VBase>vBase,
    vQuote: <VQuote>vQuote,
    curveToken: <CurveTokenV5Test>curveToken,
    market: <CurveCryptoSwapTest>cryptoSwap,
    market2: <CurveCryptoSwap2ETH>marketAsCurveCryptoSwap2ETH,
    math: <CurveMath>math,
    curveViews: <CurveCryptoViews>curveViews,
  };

  // container
  const testEnv: TestEnv = {
    deployer: await setupUser(deployer, contracts),
    trader: await setupUser(trader, contracts),
    lp: await setupUser(lp, contracts),
    lpTwo: await setupUser(lpTwo, contracts),
    vBaseA: vBase.address,
    vQuoteA: vQuote.address,
    curveTokenA: curveToken.address,
    marketA: cryptoSwap.address,
    mathA: math.address,
    curveViewsA: curveViews.address,
  };

  return testEnv;
});

/**************** TESTS START HERE ****************************/

describe('Cryptoswap: Unit tests', function () {
  // contract and accounts
  let deployer: User, lp: User, trader: User, lpTwo: User;

  let marketA: tEthereumAddress,
    vBaseA: tEthereumAddress,
    vQuoteA: tEthereumAddress,
    curveTokenA: tEthereumAddress;

  // constants
  const MIN_MINT_AMOUNT = ethers.BigNumber.from(0);

  beforeEach(async () => {
    ({deployer, lp, lpTwo, trader, marketA, vBaseA, vQuoteA, curveTokenA} =
      await setup());
  });

  async function mintAndBuyToken(
    user: User,
    inIndex: number,
    inToken: VirtualToken,
    amount: BigNumber
  ): Promise<void> {
    await mintAndApprove(inToken, amount, user.address, user.market.address);

    await _buyToken(user.market, inIndex, amount);
  }

  async function _buyToken(
    market: CurveCryptoSwapTest,
    inIndex: number,
    amount: BigNumber
  ) {
    if (inIndex > 1) throw new Error('out of range');

    const outIndex = inIndex === 0 ? 1 : 0;
    await market['exchange(uint256,uint256,uint256,uint256)'](
      inIndex,
      outIndex,
      amount,
      MIN_MINT_AMOUNT,
      {gasLimit: 1000000}
    );
  }

  async function fundCurvePool(
    user: User,
    quoteAmount: BigNumber
  ): Promise<void> {
    // mint tokens
    const baseAmount = await prepareCurveTokens(user, quoteAmount);
    await user.market['add_liquidity(uint256[2],uint256)'](
      [quoteAmount, baseAmount],
      MIN_MINT_AMOUNT,
      {gasLimit: 1000000}
    );
  }

  async function prepareCurveTokens(
    user: User,
    quoteAmount: BigNumber
  ): Promise<BigNumber> {
    const baseAmount = rDiv(quoteAmount, await user.market.price_oracle());

    await mintAndApprove(
      user.vBase,
      baseAmount,
      user.address,
      user.market.address
    );
    await mintAndApprove(
      user.vQuote,
      quoteAmount,
      user.address,
      user.market.address
    );

    return baseAmount;
  }

  async function mintAndApprove(
    token: VirtualToken,
    amount: BigNumber,
    owner: tEthereumAddress,
    spender: tEthereumAddress
  ): Promise<void> {
    const [minter] = await ethers.getSigners();

    if ((await token.perp()) !== minter.address) {
      await token.transferPerpOwner(minter.address);
      expect(minter.address).to.be.equal(await token.perp());
    }

    await token.connect(minter).mint(amount);

    await token.connect(minter).transfer(owner, amount);
    await token.approve(spender, amount);

    expect(await token.allowance(owner, spender)).to.be.equal(amount);
  }
  describe('Init', function () {
    it('Initialize parameters correctly', async function () {
      const {
        A,
        gamma,
        mid_fee,
        out_fee,
        allowed_extra_profit,
        fee_gamma,
        admin_fee,
        ma_half_time,
        adjustment_step,
      } = getCryptoSwapConfigs('EUR_USD');

      // coins
      expect(await deployer.market.coins(0)).to.be.equal(vQuoteA);
      expect(await deployer.market.coins(1)).to.be.equal(vBaseA);
      expect(await deployer.curveToken.minter()).to.be.equal(marketA);
      expect(await deployer.market.token()).to.be.equal(curveTokenA);

      // constructor parameters
      expect(await deployer.market.A()).to.be.equal(A);
      expect(await deployer.market.gamma()).to.be.equal(gamma);

      expect(await deployer.market.mid_fee()).to.be.equal(mid_fee);
      expect(await deployer.market.out_fee()).to.be.equal(out_fee);
      expect(await deployer.market.allowed_extra_profit()).to.be.equal(
        allowed_extra_profit
      );
      expect(await deployer.market.fee_gamma()).to.be.equal(fee_gamma);
      expect(await deployer.market.adjustment_step()).to.be.equal(
        adjustment_step
      );
      expect(await deployer.market.admin_fee()).to.be.equal(admin_fee);
      expect(await deployer.market.ma_half_time()).to.be.equal(ma_half_time);

      expect(await deployer.market.price_scale()).to.be.equal(initialPrice);
      expect(await deployer.market.price_oracle()).to.be.equal(initialPrice);
      expect(await deployer.market.last_prices()).to.be.equal(initialPrice);

      // global parameters
      expect(await deployer.market.is_killed()).to.be.false;
    });
  });
  describe('Liquidity', function () {
    it('Can provide liquidity', async function () {
      // mint tokens
      const quoteAmount = asBigNumber('10');
      const baseAmount = await prepareCurveTokens(lp, quoteAmount);

      expect(await lp.vQuote.balanceOf(lp.address)).be.equal(quoteAmount);
      expect(await lp.vQuote.allowance(lp.address, marketA)).be.equal(
        quoteAmount
      );
      expect(await lp.vBase.balanceOf(lp.address)).be.equal(baseAmount);
      expect(await lp.vBase.allowance(lp.address, marketA)).be.equal(
        baseAmount
      );

      // provide liquidity
      await expect(
        lp.market['add_liquidity(uint256[2],uint256)'](
          [quoteAmount, baseAmount],
          MIN_MINT_AMOUNT
        )
      )
        .to.emit(lp.market, 'AddLiquidity')
        .withArgs(lp.address, [quoteAmount, baseAmount], 0, 0);

      expect(await lp.market.balances(0)).to.be.equal(quoteAmount);
      expect(await lp.market.balances(1)).to.be.equal(baseAmount);
      expect(await lp.vBase.balanceOf(marketA)).to.be.equal(baseAmount);
      expect(await lp.vQuote.balanceOf(marketA)).to.be.equal(quoteAmount);
      expect(await lp.curveToken.balanceOf(lp.address)).to.be.above(
        await lp.market.calc_token_amount([quoteAmount, baseAmount])
      );
    });

    it('Can not provide zero liquidity', async function () {
      // provide liquidity
      await expect(
        lp.market['add_liquidity(uint256[2],uint256)']([0, 0], 0)
      ).to.be.revertedWith('');
      /*
    "" == "Error: Transaction reverted without a reason string"
    (see. https://ethereum.stackexchange.com/questions/48627/how-to-catch-revert-error-in-truffle-test-javascript)
    */
    });

    it('Can withdraw liquidity', async function () {
      // mint tokens
      const quoteAmount = asBigNumber('10');
      const baseAmount = await prepareCurveTokens(lp, quoteAmount);

      await lp.market['add_liquidity(uint256[2],uint256)'](
        [quoteAmount, baseAmount],
        MIN_MINT_AMOUNT
      );

      const lpTokenBalance = await lp.curveToken.balanceOf(lp.address);
      expect(lpTokenBalance).to.be.above(0);

      // remaining balances
      const dust = await TEST_dust_remove_liquidity(
        lp.market2,
        lpTokenBalance,
        [MIN_MINT_AMOUNT, MIN_MINT_AMOUNT]
      );
      expect(dust.quote).to.be.equal(2); // quoteDust is 2 (amount is above lpTokenBalance)
      expect(dust.base).to.be.equal(1); // baseDust is 1
      const remainingBalances = [quoteAmount.sub('2'), baseAmount.sub('1')];

      // withdraw liquidity
      await expect(
        lp.market['remove_liquidity(uint256,uint256[2])'](
          lpTokenBalance,
          [0, 0]
        )
      )
        .to.emit(lp.market, 'RemoveLiquidity')
        .withArgs(lp.address, remainingBalances, 0);
    });

    it('Can not withdraw 0 liquidity', async function () {
      // mint tokens
      const quoteAmount = asBigNumber('10');
      const baseAmount = await prepareCurveTokens(lp, quoteAmount);

      await lp.market['add_liquidity(uint256[2],uint256)'](
        [quoteAmount, baseAmount],
        MIN_MINT_AMOUNT
      );
      // remove liquidity
      await expect(
        lp.market['remove_liquidity(uint256,uint256[2])'](0, [
          MIN_MINT_AMOUNT,
          MIN_MINT_AMOUNT,
        ])
      ).to.be.revertedWith('');
      /*
    "" == "Error: Transaction reverted without a reason string"
    (see. https://ethereum.stackexchange.com/questions/48627/how-to-catch-revert-error-in-truffle-test-javascript)
    */
    });

    it('Can deposit liquidity twice', async function () {
      // mint tokens
      const quoteAmount = asBigNumber('10');
      const baseAmount = rDiv(quoteAmount, await lp.market.price_oracle());
      await mintAndApprove(lp.vQuote, quoteAmount.mul(2), lp.address, marketA);
      await mintAndApprove(lp.vBase, quoteAmount.mul(2), lp.address, marketA);

      await lp.market['add_liquidity(uint256[2],uint256)'](
        [quoteAmount, baseAmount],
        MIN_MINT_AMOUNT,
        {gasLimit: 1000000}
      );
      await lp.market['add_liquidity(uint256[2],uint256)'](
        [quoteAmount, baseAmount],
        MIN_MINT_AMOUNT,
        {gasLimit: 1000000}
      );

      expect(await lp.market.balances(0)).to.be.equal(quoteAmount.mul(2));
      expect(await lp.market.balances(1)).to.be.equal(baseAmount.mul(2));
      expect(await lp.vBase.balanceOf(marketA)).to.be.equal(baseAmount.mul(2));
      expect(await lp.vQuote.balanceOf(marketA)).to.be.equal(
        quoteAmount.mul(2)
      );
    });
    async function mintAndProvideLiquidity(
      user: User,
      baseAmount: BigNumber,
      quoteAmount: BigNumber
    ): Promise<BigNumber> {
      await mintAndApprove(
        user.vBase,
        baseAmount,
        user.address,
        user.market.address
      );
      await mintAndApprove(
        user.vQuote,
        quoteAmount,
        user.address,
        user.market.address
      );

      // provide liquidity
      const balanceBefore = await user.curveToken.balanceOf(user.address);

      await user.market['add_liquidity(uint256[2],uint256)'](
        [quoteAmount, baseAmount],
        MIN_MINT_AMOUNT,
        {gasLimit: 1000000}
      );

      const balanceAfter = await user.curveToken.balanceOf(user.address);

      const lpTokenMinted = balanceAfter.sub(balanceBefore);

      return lpTokenMinted;
    }

    it('Can provide liquidity with uneven ratios', async function () {
      /* Open questions: */
      // Does that allow LPs to behave like *pseudo* traders by providing and withdrawing liquidity in the same tx?

      /* init */
      await fundCurvePool(lp, asBigNumber('10'));

      await mintAndBuyToken(trader, 1, trader.vBase, asBigNumber('1'));

      // mint tokens
      const quoteAmount = asBigNumber('10');
      let baseAmount;

      // at price_oracle ratio
      baseAmount = rDiv(quoteAmount, await trader.market.price_oracle());
      await mintAndProvideLiquidity(lpTwo, baseAmount, quoteAmount);

      // at price_scale ratio
      baseAmount = rDiv(quoteAmount, await trader.market.price_scale());
      await mintAndProvideLiquidity(lpTwo, baseAmount, quoteAmount);

      // at balances ratio
      baseAmount = rDiv(
        quoteAmount,
        rDiv(await trader.market.balances(0), await trader.market.balances(1))
      );
      await mintAndProvideLiquidity(lpTwo, baseAmount, quoteAmount);

      // none of base
      baseAmount = BigNumber.from(0);
      await mintAndProvideLiquidity(lpTwo, baseAmount, quoteAmount);
    });
  });
  describe('Trading', function () {
    it('Can call dy on quoteToken', async function () {
      await fundCurvePool(lp, asBigNumber('10'));

      const dx = asBigNumber('1');
      await mintAndApprove(trader.vQuote, dx, trader.address, marketA);
      const expectedResult = (await TEST_get_dy(trader.market, 0, 1, dx)).dy;
      const result = await trader.market.get_dy(0, 1, dx);
      expect(result).to.be.equal(expectedResult);
    });

    it('Can call dy on baseToken', async function () {
      await fundCurvePool(lp, asBigNumber('10'));

      const dx = asBigNumber('1');
      await mintAndApprove(trader.vBase, dx, trader.address, marketA);
      const expectedResult = (await TEST_get_dy(trader.market, 1, 0, dx)).dy;
      const result = await trader.market.get_dy(1, 0, dx);
      expect(result).to.be.equal(expectedResult);
    });

    it('Can exchange quote for base token, emit event', async function () {
      await fundCurvePool(lp, asBigNumber('10000'));

      // mint tokens to trade
      const sellQuoteAmount = asBigNumber('100');
      await mintAndApprove(
        trader.vQuote,
        sellQuoteAmount,
        trader.address,
        marketA
      );

      // trade some tokens
      const eBuyBaseAmount = await trader.market.get_dy(0, 1, sellQuoteAmount);
      await expect(
        trader.market['exchange(uint256,uint256,uint256,uint256)'](
          0,
          1,
          sellQuoteAmount,
          MIN_MINT_AMOUNT,
          {gasLimit: 1000000}
        )
      )
        .to.emit(trader.market, 'TokenExchange')
        .withArgs(trader.address, 0, sellQuoteAmount, 1, eBuyBaseAmount);

      // check balances after trade
      expect(await trader.vBase.balanceOf(trader.address)).to.be.equal(
        eBuyBaseAmount
      );
    });

    it('Can exchange base for quote token, emit event', async function () {
      await fundCurvePool(lp, asBigNumber('10'));

      // mint tokens to trade
      const sellBaseAmount = asBigNumber('1');
      await mintAndApprove(
        trader.vBase,
        sellBaseAmount,
        trader.address,
        marketA
      );

      // trade some tokens
      const eBuyQuoteAmount = await trader.market.get_dy(1, 0, sellBaseAmount);
      await expect(
        trader.market['exchange(uint256,uint256,uint256,uint256)'](
          1,
          0,
          sellBaseAmount,
          MIN_MINT_AMOUNT,
          {gasLimit: 1000000}
        )
      )
        .to.emit(trader.market, 'TokenExchange')
        .withArgs(trader.address, 1, sellBaseAmount, 0, eBuyQuoteAmount);

      // check balances after trade
      expect(await trader.vQuote.balanceOf(trader.address)).to.be.equal(
        eBuyQuoteAmount
      );
    });
    it('Can perform (approximated) Exact Output Swap for Base', async function () {
      /* init */
      await fundCurvePool(lp, asBigNumber('1000'));

      await mintAndBuyToken(trader, 1, trader.vBase, asBigNumber('1'));

      // swap for exact quote tokens
      const swapAmount = asBigNumber('1');
      const result = await TEST_get_exactOutputSwapExFees(
        trader.market2,
        trader.curveViews,
        swapAmount,
        MAX_UINT_AMOUNT,
        0,
        1
      );
      expect(result.amountOut).to.be.at.least(swapAmount);
      expect(
        await trader.curveViews.get_dy_ex_fees(
          trader.market.address,
          0,
          1,
          result.amountIn
        )
      ).to.be.equal(result.amountOut);
    });
    it('Can perform (approximated) Exact Output Swap for Quote', async function () {
      /* init */
      await fundCurvePool(lp, asBigNumber('1000'));

      await mintAndBuyToken(trader, 1, trader.vBase, asBigNumber('1'));

      // swap for exact base tokens
      const swapAmount = asBigNumber('1');
      const result = await TEST_get_exactOutputSwapExFees(
        trader.market2,
        trader.curveViews,
        swapAmount,
        MAX_UINT_AMOUNT,
        1,
        0
      );
      expect(result.amountOut).to.be.at.least(swapAmount);
      expect(
        await trader.curveViews.get_dy_ex_fees(
          trader.market.address,
          1,
          0,
          result.amountIn
        )
      ).to.be.equal(result.amountOut);
    });

    it('Can buy base tokens twice', async function () {
      await fundCurvePool(lp, asBigNumber('10'));

      const dx = asBigNumber('1');

      // first trade
      await mintAndBuyToken(trader, 1, trader.vBase, dx);

      const balancesVQuoteBefore = await trader.vQuote.balanceOf(
        trader.address
      );

      // second trade
      const eBuyQuoteAmount = await trader.market.get_dy(1, 0, dx);
      await mintAndBuyToken(trader, 1, trader.vBase, dx);

      // check balances after trade
      const balancesVQuoteAfter = await trader.vQuote.balanceOf(trader.address);
      expect(balancesVQuoteAfter).to.be.equal(
        balancesVQuoteBefore.add(eBuyQuoteAmount)
      );
    });
  });
  describe('Liquidity & Trading', function () {
    it('Can provide liquidity after some trading', async function () {
      /* init */
      await fundCurvePool(lp, asBigNumber('10'));

      await mintAndBuyToken(trader, 1, trader.vBase, asBigNumber('1'));

      /* provide liquidity */

      // mint tokens
      const quoteAmount = asBigNumber('10');
      const baseAmount = await prepareCurveTokens(lpTwo, quoteAmount);

      expect(await lpTwo.vQuote.balanceOf(lpTwo.address)).be.equal(quoteAmount);
      expect(await lpTwo.vQuote.allowance(lpTwo.address, marketA)).be.equal(
        quoteAmount
      );
      expect(await lpTwo.vBase.balanceOf(lpTwo.address)).be.equal(baseAmount);
      expect(await lpTwo.vBase.allowance(lpTwo.address, marketA)).be.equal(
        baseAmount
      );

      const balanceQuoteBefore = await lpTwo.market.balances(0);
      const balanceBaseBefore = await lpTwo.market.balances(1);

      // provide liquidity
      await lpTwo.market['add_liquidity(uint256[2],uint256)'](
        [quoteAmount, baseAmount],
        MIN_MINT_AMOUNT,
        {gasLimit: 1000000}
      );

      expect(await lpTwo.market.balances(0)).to.be.equal(
        balanceQuoteBefore.add(quoteAmount)
      );
      expect(await lpTwo.market.balances(1)).to.be.equal(
        balanceBaseBefore.add(baseAmount)
      );
      expect(await lpTwo.vBase.balanceOf(marketA)).to.be.equal(
        balanceBaseBefore.add(baseAmount)
      );
      expect(await lpTwo.vQuote.balanceOf(marketA)).to.be.equal(
        balanceQuoteBefore.add(quoteAmount)
      );
      expect(await lpTwo.curveToken.balanceOf(lpTwo.address)).to.be.above(
        await lpTwo.market.calc_token_amount([quoteAmount, baseAmount])
      );
    });
    it('Can withdraw liquidity after some trading', async function () {
      /* init */
      await fundCurvePool(lp, asBigNumber('10'));
      await mintAndBuyToken(trader, 1, trader.vBase, asBigNumber('1'));

      /* provide liquidity */

      // mint tokens
      const quoteAmount = asBigNumber('10');
      const baseAmount = await prepareCurveTokens(lp, quoteAmount);

      // provide liquidity
      await lp.market['add_liquidity(uint256[2],uint256)'](
        [quoteAmount, baseAmount],
        MIN_MINT_AMOUNT,
        {gasLimit: 1000000}
      );

      /* withdraw liquidity */
      // check balances before withdrawal
      const balanceVQuoteBeforeUser = await lp.vQuote.balanceOf(lp.address);
      const balanceVBaseBeforeUser = await lp.vBase.balanceOf(lp.address);
      const balanceVQuoteBeforeMarket = await lp.vQuote.balanceOf(marketA);
      const balanceVBaseBeforeMarket = await lp.vBase.balanceOf(marketA);
      expect(balanceVQuoteBeforeUser).to.be.equal(0);
      expect(balanceVBaseBeforeUser).to.be.equal(0);

      // withdraw liquidity
      const withdrawableAmount = await lp.curveToken.balanceOf(lp.address);
      const eWithdrawAmount = await TEST_get_remove_liquidity(
        lp.market2,
        withdrawableAmount,
        [MIN_MINT_AMOUNT, MIN_MINT_AMOUNT]
      );
      await lp.market['remove_liquidity(uint256,uint256[2])'](
        withdrawableAmount,
        [MIN_MINT_AMOUNT, MIN_MINT_AMOUNT]
      );

      // check balances after withdrawal
      const balanceVQuoteAfterUser = await lp.vQuote.balanceOf(lp.address);
      const balanceVBaseAfterUser = await lp.vBase.balanceOf(lp.address);
      const balanceVQuoteAfterMarket = await lp.vQuote.balanceOf(marketA);
      const balanceVBaseAfterMarket = await lp.vBase.balanceOf(marketA);

      expect(balanceVBaseBeforeMarket).to.be.equal(
        balanceVBaseAfterMarket.add(balanceVBaseAfterUser)
      );
      expect(balanceVQuoteBeforeMarket).to.be.equal(
        balanceVQuoteAfterMarket.add(balanceVQuoteAfterUser)
      );
      expect(eWithdrawAmount.quote).to.be.equal(balanceVQuoteAfterUser);
      expect(eWithdrawAmount.base).to.be.equal(balanceVBaseAfterUser);
    });
    describe('Dynamic trading fees', function () {
      async function predictTradingFees(
        tradeAmount: BigNumber,
        sellIndex: number
      ) {
        const buyIndex = sellIndex === 0 ? 1 : 0;

        // viewer
        const dy_ex_fees = await trader.curveViews.get_dy_ex_fees(
          trader.market.address,
          sellIndex,
          buyIndex,
          tradeAmount
        );
        const dy_incl_fees = await trader.market.get_dy(
          sellIndex,
          buyIndex,
          tradeAmount
        );

        // low lever caller
        const e = await TEST_get_dy(
          trader.market,
          sellIndex,
          buyIndex,
          tradeAmount
        );
        const e_dy_ex_fees = e.dy.add(e.fees);

        // check that the two are equal
        expect(dy_ex_fees).to.be.be.equal(e_dy_ex_fees);
        expect(dy_ex_fees.sub(dy_incl_fees)).to.be.be.equal(e.fees);
      }

      async function changeCurveFees(
        newMidFee: BigNumber,
        newOutFee: BigNumber
      ) {
        await takeOverAndFundAccount(await trader.market.owner());
        const owner = await setupUser(await trader.market.owner(), {
          market: trader.market,
        });

        await owner.market.commit_new_parameters(
          newMidFee,
          newOutFee,
          await owner.market.admin_fee(),
          await owner.market.fee_gamma(),
          await owner.market.allowed_extra_profit(),
          await owner.market.adjustment_step(),
          await owner.market.ma_half_time()
        );

        await setNextBlockTimestampWithArg(
          env,
          (await owner.market.admin_actions_deadline()).toNumber()
        );

        await owner.market.apply_new_parameters();
      }
      beforeEach(async () => {
        await fundCurvePool(lp, asBigNumber('10000'));
      });

      it('Can calculate the trading fees for mid_fee = out_fee', async function () {
        await predictTradingFees(asBigNumber('100'), 0);
        await predictTradingFees(asBigNumber('100'), 1);
      });

      it('Can calculate the trading fees for mid_fee < out_fee', async function () {
        await changeCurveFees(
          (await trader.market.mid_fee()).div(2),
          (await trader.market.out_fee()).mul(2)
        );

        await predictTradingFees(asBigNumber('100'), 0);
        await predictTradingFees(asBigNumber('100'), 1);
      });
      it('Can approximately get_dx', async function () {
        const dx_ex_fees = await trader.curveViews.get_dx_ex_fees(
          trader.market.address,
          0,
          1,
          asBigNumber('100')
        );
        const dy_ex_fees = await trader.curveViews.get_dy_ex_fees(
          trader.market.address,
          0,
          1,
          dx_ex_fees
        );

        expect(dy_ex_fees).to.be.not.equal(asBigNumber('100'));
        expect(dy_ex_fees.sub(asBigNumber('100'))).to.be.lt(asBigNumber('0.1'));
      });
      it('Can approximately get_dx', async function () {
        const dx_ex_fees = await trader.curveViews.get_dx_ex_fees(
          trader.market.address,
          1,
          0,
          asBigNumber('100')
        );
        const dy_ex_fees = await trader.curveViews.get_dy_ex_fees(
          trader.market.address,
          1,
          0,
          dx_ex_fees
        );

        expect(dy_ex_fees).to.not.be.equal(asBigNumber('100'));
        expect(dy_ex_fees.sub(asBigNumber('100'))).to.be.lt(asBigNumber('0.1'));
      });
    });
  });
});
