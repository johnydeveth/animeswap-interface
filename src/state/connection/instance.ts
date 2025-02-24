import SDK, {
  AptosCoinInfoResource,
  AptosCoinStoreResource,
  AptosResource,
  NetworkType,
  SwapPoolResource,
  Utils,
} from '@animeswap.org/v1-sdk'
import { AptosClient } from 'aptos'
import { CHAIN_IDS_TO_SDK_NETWORK, SupportedChainId } from 'constants/chains'
import { Pair } from 'hooks/common/Pair'
import store from 'state'
import { addCoin, updatePair } from 'state/user/reducer'
import { resetCoinBalances, resetLpBalances, setCoinBalances } from 'state/wallets/reducer'

import { ConnectionType, getRPCURL } from './reducer'

class ConnectionInstance {
  private static aptosClient: AptosClient
  private static sdk: SDK

  public static getAptosClient(): AptosClient {
    if (!ConnectionInstance.aptosClient) {
      const state = store.getState()
      ConnectionInstance.aptosClient = new AptosClient(
        getRPCURL(state.connection.currentConnection, state.user.chainId)
      )
    }
    return ConnectionInstance.aptosClient
  }

  public static renewAptosClient(connection: ConnectionType, chainId: SupportedChainId) {
    ConnectionInstance.aptosClient = new AptosClient(getRPCURL(connection, chainId))
  }

  public static getSDK(): SDK {
    if (!ConnectionInstance.sdk) {
      const state = store.getState()
      const networkType: NetworkType = CHAIN_IDS_TO_SDK_NETWORK[state.user.chainId]
      ConnectionInstance.sdk = new SDK(getRPCURL(state.connection.currentConnection, state.user.chainId), networkType)
    }
    return ConnectionInstance.sdk
  }

  public static renewSDK(connection: ConnectionType, chainId: SupportedChainId) {
    const networkType: NetworkType = CHAIN_IDS_TO_SDK_NETWORK[chainId]
    ConnectionInstance.sdk = new SDK(getRPCURL(connection, chainId), networkType)
  }

  public static async syncAccountResources(account: string) {
    try {
      if (!account) return undefined
      const aptosClient = ConnectionInstance.getAptosClient()
      const res: AptosResource<any>[] = await aptosClient.getAccountResources(account)
      const coinStore = this.getSDK().networkOptions.modules.CoinStore
      const lpCoinNamespace = Utils.composeLPCoinType(this.getSDK().networkOptions.modules.ResourceAccountAddress)
      const coinBalances = {}
      const lpBalances = {}
      for (const resource of res) {
        const type = resource.type
        // coin balance filter
        if (type.startsWith(`${coinStore}<`)) {
          const coinType = type.substring(coinStore.length + 1, type.length - 1)
          coinBalances[coinType] = resource.data.coin.value
          // LP balance filter
          if (coinType.startsWith(`${lpCoinNamespace}<`)) {
            const lpCoinType = coinType.substring(lpCoinNamespace.length + 1, coinType.length - 1)
            lpBalances[lpCoinType] = resource.data.coin.value
            const [coinX, coinY] = lpCoinType.split(', ')
            this.getPair(coinX, coinY)
          }
        }
      }
      store.dispatch(resetCoinBalances({ coinBalances }))
      store.dispatch(resetLpBalances({ lpBalances }))
      return res
    } catch (error) {
      store.dispatch(resetCoinBalances({ coinBalances: {} }))
      store.dispatch(resetLpBalances({ lpBalances: {} }))
      return undefined
    }
  }

  public static async getAccountResource(account: string, type: string) {
    try {
      if (!account || !type) {
        return undefined
      }
      const aptosClient = ConnectionInstance.getAptosClient()
      const res: AptosResource<any> = await aptosClient.getAccountResource(account, type)
      const data = res.data
      return data
    } catch (error) {
      return undefined
    }
  }

  public static async getCoinBalance(account: string, type: string) {
    try {
      if (!account || !type) {
        return undefined
      }
      console.log(`getCoinBalance ${account} ${type}`)
      const coinStore = this.getSDK().networkOptions.modules.CoinStore
      const res: AptosCoinStoreResource = await ConnectionInstance.getAccountResource(
        account,
        Utils.composeCoinStore(coinStore, type)
      )
      console.log(`getCoinBalance return`, res)
      const amount = res.coin.value
      store.dispatch(setCoinBalances({ coinBalances: { [type]: amount } }))
      return amount
    } catch (error) {
      return undefined
    }
  }

  // sync from pool pair
  public static async getPair(coinX: string, coinY: string): Promise<Pair> {
    try {
      if (!coinX || !coinY) return undefined
      const modules = this.getSDK().networkOptions.modules
      const lpCoin = Utils.composeLPCoin(modules.ResourceAccountAddress, coinX, coinY)
      const lpType = Utils.composeLP(modules.Scripts, coinX, coinY)
      const getLPCoinInfo: AptosCoinInfoResource = await ConnectionInstance.getAccountResource(
        modules.ResourceAccountAddress,
        Utils.composeType(modules.CoinInfo, [lpCoin])
      )
      const getLPPool: SwapPoolResource = await ConnectionInstance.getAccountResource(
        modules.ResourceAccountAddress,
        lpType
      )
      const [lpCoinInfo, lpPool] = await Promise.all([getLPCoinInfo, getLPPool])
      // pair not exist
      if (lpCoinInfo == undefined || lpPool == undefined) {
        return null
      }
      const lpTotal = lpCoinInfo.supply.vec[0].integer.vec[0].value
      const coinXReserve = lpPool.coin_x_reserve.value
      const coinYReserve = lpPool.coin_y_reserve.value
      const pair: Pair = {
        coinX,
        coinY,
        lpTotal,
        coinXReserve,
        coinYReserve,
      }
      store.dispatch(updatePair({ pair }))
      return pair
    } catch (error) {
      store.dispatch(updatePair({ pair: undefined }))
      return undefined
    }
  }

  public static async addCoin(address: string) {
    try {
      const splits = address.split('::')
      const account = splits[0]
      const coin: AptosCoinInfoResource = await this.getAccountResource(account, `0x1::coin::CoinInfo<${address}>`)
      if (coin) {
        store.dispatch(
          addCoin({
            coin: {
              address,
              decimals: coin.decimals,
              symbol: coin.symbol,
              name: coin.name,
            },
          })
        )
      }
    } catch (error) {
      console.error('addCoin', error)
    }
  }
}

export default ConnectionInstance
