// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.15;

// contracts
import "../../../contracts/ClearingHouse.sol";
import "../../../contracts/Insurance.sol";
import "../../../contracts/Oracle.sol";
import "../../../contracts/ClearingHouseViewer.sol";
import "../../../contracts/CurveCryptoViews.sol";
import "../../../contracts/test/TestPerpetual.sol";
import "../../../contracts/test/TestVault.sol";
import "../../../contracts/tokens/UA.sol";
import "../../../contracts/tokens/VBase.sol";
import "../../../contracts/tokens/VQuote.sol";
import "../../../contracts/mocks/MockAggregator.sol";

// interfaces
import "../../../contracts/interfaces/ICryptoSwap.sol";
import "../../../contracts/interfaces/IPerpetual.sol";
import "../../../contracts/interfaces/IClearingHouse.sol";
import "../../../contracts/interfaces/ICurveCryptoFactory.sol";
import "../../../contracts/interfaces/IVault.sol";
import "../../../contracts/interfaces/IInsurance.sol";
import "../../../contracts/interfaces/IMath.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// utils
import "./VyperDeployer.sol";

abstract contract Deployment {
    ///@notice create a new instance of VyperDeployer
    VyperDeployer vyperDeployer = new VyperDeployer();

    /* contracts */
    ICurveCryptoFactory public factory;
    ICryptoSwap public cryptoSwap;
    AggregatorV3Interface public euroOracle;
    AggregatorV3Interface public usdcOracle;

    ClearingHouse public clearingHouse;
    TestPerpetual public perpetual;
    TestVault public vault;
    Insurance public insurance;
    MockAggregator public sequencerUptimeFeed;
    Oracle public oracle;
    ClearingHouseViewer public viewer;

    IERC20Metadata public usdc;
    UA public ua;
    VBase public vBase;
    VQuote public vQuote;
    IERC20Metadata public lpToken;

    IMath public math;
    CurveCryptoViews public curveCryptoViews;

    /* oracle params */
    uint256 constant gracePeriod = 5 minutes;
    uint24 constant oracleHeartBeat = 25 hours;

    /* vBase params */
    uint256 constant vBaseHeartBeat = 25 hours;

    /* curve params */
    uint256 constant A = 200000000;
    uint256 constant gamma = 100000000000000;
    uint256 constant mid_fee = 5000000;
    uint256 constant out_fee = 50000000;
    uint256 constant allowed_extra_profit = 100000000000;
    uint256 constant fee_gamma = 5000000000000000;
    uint256 constant adjustment_step = 5500000000000;
    uint256 constant admin_fee = 0;
    uint256 constant ma_half_time = 600;
    uint256 constant initial_price = 1134810000000000000;

    /* perp params */
    IPerpetual.PerpetualParams perp_params =
        IPerpetual.PerpetualParams({
            riskWeight: 1 ether,
            maxLiquidityProvided: 1_0000_000 ether,
            twapFrequency: 15 minutes,
            sensitivity: 1e18,
            maxBlockTradeAmount: 100_000 ether,
            insuranceFee: 0.0001 ether,
            lpDebtCoef: 3 ether,
            lockPeriod: 1 hours
        });

    /* clearingHouse params */
    IClearingHouse.ClearingHouseParams clearingHouse_params =
        IClearingHouse.ClearingHouseParams({
            minMargin: 0.025 ether,
            minMarginAtCreation: 0.055 ether,
            minPositiveOpenNotional: 35 ether,
            liquidationReward: 0.015 ether,
            insuranceRatio: 0.1 ether,
            liquidationRewardInsuranceShare: 0.5 ether,
            liquidationDiscount: 0.95 ether,
            nonUACollSeizureDiscount: 0.75 ether,
            uaDebtSeizureThreshold: 10000 ether
        });

    function setUp() public virtual {
        /* get existing deployments */
        factory = ICurveCryptoFactory(address(0xF18056Bbd320E96A48e3Fbf8bC061322531aac99));
        usdc = IERC20Metadata(address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48));
        euroOracle = AggregatorV3Interface(address(0xb49f677943BC038e9857d61E7d053CaA2C1734C1));
        usdcOracle = AggregatorV3Interface(address(0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6));

        /*  deploy own contracts*/

        // 001_deploy_UA
        ua = new UA(usdc, type(uint256).max);

        // 002_deploy_vault
        vault = new TestVault(ua);

        // 003_deploy_insurance
        insurance = new Insurance(ua, vault);
        vault.setInsurance(insurance);

        // 004_deploy_oracle
        // deploy mock sequencer uptime feed
        sequencerUptimeFeed = new MockAggregator(8);

        oracle = new Oracle(sequencerUptimeFeed, gracePeriod);
        oracle.setOracle(address(ua), usdcOracle, oracleHeartBeat, false);
        oracle.setFixedPrice(address(ua), 1 ether);
        vault.setOracle(oracle);

        // 005_deploy_clearingHouse
        clearingHouse = new ClearingHouse(vault, insurance, clearingHouse_params);
        vault.setClearingHouse(clearingHouse);
        insurance.setClearingHouse(clearingHouse);

        // 006_deploy_virtual_tokens
        vBase = new VBase("vEUR base token", "vEUR", euroOracle, vBaseHeartBeat, sequencerUptimeFeed, gracePeriod);
        vQuote = new VQuote("vUSD quote token", "vUSD");

        // 007_create_curve_pool
        cryptoSwap = ICryptoSwap(
            factory.deploy_pool(
                "EUR_USD",
                "EUR_USD",
                [address(vQuote), address(vBase)],
                A,
                gamma,
                mid_fee,
                out_fee,
                allowed_extra_profit,
                fee_gamma,
                adjustment_step,
                admin_fee,
                ma_half_time,
                initial_price
            )
        );
        lpToken = IERC20Metadata(cryptoSwap.token());

        // 008_deploy_curveCryptoViews
        math = IMath(vyperDeployer.deployContract("CurveMath"));
        curveCryptoViews = new CurveCryptoViews(address(math));

        // 009_deploy_perpetuals
        perpetual = new TestPerpetual(vBase, vQuote, cryptoSwap, clearingHouse, curveCryptoViews, perp_params);

        vBase.transferPerpOwner(address(perpetual));
        vQuote.transferPerpOwner(address(perpetual));
        clearingHouse.allowListPerpetual(perpetual);

        // 010_deploy_clearingHouseViewer
        viewer = new ClearingHouseViewer(clearingHouse);
    }
}
