# source environment variables when not already set (e.g. in github action)
if [ -z ${ETH_NODE_URI_MAINNET+x} ]; then
  echo "load fork url from .env file"
  . ./.env
fi
forge test --fork-url $ETH_NODE_URI_MAINNET --fork-block-number 14191019 -vvv --ffi # run all fuzz tests
