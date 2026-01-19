"use client";

import { ReactNode } from "react";
import { mainnet } from "@starknet-react/chains";
import {
  StarknetConfig,
  argent,
  braavos,
  useInjectedConnectors,
  voyager,
} from "@starknet-react/core";
import { RpcProvider } from "starknet";
import { WebWalletConnector } from "starknetkit/webwallet";
import { ArgentMobileConnector } from "starknetkit/argentMobile";

export function StarknetProvider({ children }: { children: ReactNode }) {
  const { connectors: injected } = useInjectedConnectors({
    recommended: [argent(), braavos()],
    includeRecommended: "always",
  });

  const connectors = [
    ...injected,
    new WebWalletConnector({ url: "https://web.argent.xyz" }),
    ArgentMobileConnector.init({
      options: {
        dappName: "Zylith",
        url: typeof window !== "undefined" ? window.location.origin : "",
      },
    }),
  ];

  function provider() {
    return new RpcProvider({
      nodeUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://starknet-sepolia-rpc.publicnode.com",
    });
  }

  return (
    <StarknetConfig
      chains={[mainnet]}
      provider={provider}
      connectors={connectors}
      explorer={voyager}
      autoConnect
    >
      {children}
    </StarknetConfig>
  );
}
