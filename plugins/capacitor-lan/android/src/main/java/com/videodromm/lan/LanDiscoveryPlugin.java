package com.videodromm.lan;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The WebApp's way to find TSWebsocketServer on the home network (src/lib/lanDiscovery.ts):
 * - getWifiAddress(): the phone's IPv4 address and prefix on Wi-Fi (or Ethernet), for the
 *   subnet scan; {} when it has none
 * - discover({ type, timeout }): the first mDNS / DNS-SD service of that type that resolves
 *   (TSWebsocketServer announces "_videodromm._tcp", server/utils/mdns.ts), as
 *   { host, port, name }; {} after timeout ms
 */
@CapacitorPlugin(name = "LanDiscovery")
public class LanDiscoveryPlugin extends Plugin {

    @SuppressWarnings("deprecation")
    @PluginMethod
    public void getWifiAddress(PluginCall call) {
        JSObject ret = new JSObject();
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            // every network, not only the active one: on a Wi-Fi without internet access the
            // active network can be the mobile one
            for (Network network : cm.getAllNetworks()) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(network);
                if (caps == null) continue;
                if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) continue;
                LinkProperties props = cm.getLinkProperties(network);
                if (props == null) continue;
                for (LinkAddress link : props.getLinkAddresses()) {
                    InetAddress address = link.getAddress();
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        ret.put("ip", address.getHostAddress());
                        ret.put("prefix", link.getPrefixLength());
                        call.resolve(ret);
                        return;
                    }
                }
            }
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void discover(PluginCall call) {
        String type = call.getString("type", "_videodromm._tcp.");
        Integer timeoutValue = call.getInt("timeout", 3000);
        int timeout = timeoutValue != null ? timeoutValue : 3000;
        NsdManager nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        if (nsd == null) {
            call.resolve(new JSObject());
            return;
        }
        new Discovery(nsd, call).start(type, timeout);
    }

    /** One discover() call: stops at the first resolved service or at the timeout. */
    private class Discovery {
        private final NsdManager nsd;
        private final PluginCall call;
        private final Handler main = new Handler(Looper.getMainLooper());
        private final AtomicBoolean done = new AtomicBoolean(false);
        private final AtomicBoolean resolving = new AtomicBoolean(false);
        private WifiManager.MulticastLock lock;
        private NsdManager.DiscoveryListener listener;
        private boolean discovering = false;

        Discovery(NsdManager nsd, PluginCall call) {
            this.nsd = nsd;
            this.call = call;
        }

        void start(String type, int timeout) {
            // some phones drop multicast (mDNS) packets unless an app holds this lock
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                lock = wifi.createMulticastLock("videodromm-lan");
                lock.setReferenceCounted(false);
                lock.acquire();
            }
            listener = new NsdManager.DiscoveryListener() {
                @Override
                public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                    discovering = false;
                    finish(new JSObject());
                }

                @Override
                public void onStopDiscoveryFailed(String serviceType, int errorCode) {}

                @Override
                public void onDiscoveryStarted(String serviceType) {
                    discovering = true;
                }

                @Override
                public void onDiscoveryStopped(String serviceType) {
                    discovering = false;
                }

                @Override
                public void onServiceFound(NsdServiceInfo info) {
                    // NsdManager resolves one service at a time: the first one found
                    if (resolving.compareAndSet(false, true)) resolve(info);
                }

                @Override
                public void onServiceLost(NsdServiceInfo info) {}
            };
            main.postDelayed(() -> finish(new JSObject()), timeout);
            try {
                nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener);
            } catch (Exception e) {
                finish(new JSObject());
            }
        }

        @SuppressWarnings("deprecation")
        private void resolve(NsdServiceInfo info) {
            try {
                nsd.resolveService(info, new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                        resolving.set(false);
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo serviceInfo) {
                        InetAddress host = serviceInfo.getHost();
                        if (host == null) {
                            resolving.set(false);
                            return;
                        }
                        JSObject ret = new JSObject();
                        ret.put("host", host.getHostAddress());
                        ret.put("port", serviceInfo.getPort());
                        ret.put("name", serviceInfo.getServiceName());
                        finish(ret);
                    }
                });
            } catch (Exception e) {
                resolving.set(false);
            }
        }

        private void finish(JSObject result) {
            if (!done.compareAndSet(false, true)) return;
            main.removeCallbacksAndMessages(null);
            // also when onDiscoveryStarted hasn't come yet (a timeout right after the start);
            // stopping a discovery that never started throws, which is fine here
            if (listener != null) {
                try {
                    nsd.stopServiceDiscovery(listener);
                } catch (Exception ignored) {}
            }
            if (lock != null && lock.isHeld()) lock.release();
            call.resolve(result);
        }
    }
}
