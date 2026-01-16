"use client";

import { useAccount, useConnect, useDisconnect } from "@starknet-react/core";
import { Wallet, LogOut, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useStarknetkitConnectModal } from "starknetkit";

export default function ConnectWallet() {
  const { address, status } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [showDropdown, setShowDropdown] = useState(false);

  const { starknetkitConnectModal } = useStarknetkitConnectModal({
    connectors: connectors as any,
  });

  const handleConnect = async () => {
    const { connector } = await starknetkitConnectModal();
    if (connector) {
      connect({ connector });
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  if (status === "connected" && address) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 glass px-4 py-2 rounded-xl glass-hover cursor-pointer"
        >
          <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
          <span className="text-sm font-bold text-white/80 group-hover:text-white">
            {formatAddress(address)}
          </span>
          <ChevronDown className={`w-4 h-4 text-white/40 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
        </button>

        {showDropdown && (
          <>
            <div 
              className="fixed inset-0 z-60 cursor-pointer" 
              onClick={() => setShowDropdown(false)}
            />
            <div className="absolute right-0 mt-2 w-48 bg-[#0D0D0D] border border-white/10 rounded-2xl p-2 shadow-2xl z-70 animate-in fade-in zoom-in duration-200">
              <button
                onClick={() => {
                  disconnect();
                  setShowDropdown(false);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-500/10 text-white/60 hover:text-red-400 transition-colors text-sm font-medium cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      className="bg-linear-to-r from-purple-600 to-blue-600 hover:shadow-[0_0_20px_rgba(147,51,234,0.3)] text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 cursor-pointer flex items-center gap-2 border border-white/10"
    >
      <Wallet className="w-4 h-4" />
      Connect Wallet
    </button>
  );
}
