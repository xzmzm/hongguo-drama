// SPDX-License-Identifier: GPL-3.0-only
package com.sign.oracle;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.pm.ApplicationInfo;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.Map;
import dalvik.system.DexClassLoader;

/** Reflective adapter only; SDK code, native library and SDK values are local inputs. */
final class Metasec {
    private static Metasec instance;
    private Object manager;
    private Method getFeatureHash, setDeviceId, setInstallId;
    private boolean ready;

    static synchronized Metasec get(Context context) {
        // Keep the same SDK/class loader across service restarts in this process.
        if (instance == null) {
            instance = new Metasec();
            instance.init(context.getApplicationContext());
        }
        return instance;
    }

    boolean isReady() { return ready; }

    private void init(Context host) {
        try {
            OracleConfig config = OracleConfig.load(host);
            ApplicationInfo target = host.getPackageManager().getApplicationInfo(config.targetPackage, 0);
            final Context sdkContext = new ContextWrapper(host) {
                @Override public String getPackageName() { return config.targetPackage; }
                @Override public Context getApplicationContext() { return this; }
            };
            DexClassLoader loader = new DexClassLoader(target.sourceDir, host.getCodeCacheDir().getAbsolutePath(),
                host.getApplicationInfo().nativeLibraryDir, host.getClassLoader());
            Class<?> builderClass = loader.loadClass("com.bytedance.mobsec.metasec.ml.MSConfig$Builder");
            Class<?> configClass = loader.loadClass("com.bytedance.mobsec.metasec.ml.MSConfig");
            Class<?> utilsClass = loader.loadClass("com.bytedance.mobsec.metasec.ml.MSManagerUtils");
            Class<?> managerClass = loader.loadClass("com.bytedance.mobsec.metasec.ml.MSManager");
            Class<?> setting = loader.loadClass("com.bytedance.mobsec.metasec.ml.MSConfig$Builder$IMsSettingConfig");
            Class<?> fetchedDid = loader.loadClass("com.bytedance.mobsec.metasec.ml.MSConfig$Builder$IFetchedDid");
            Class<?> fetchSettings = loader.loadClass("com.bytedance.mobsec.metasec.ml.MSConfig$Builder$IFetchAppSettingsByKey");
            Class<?> settingsUpdated = loader.loadClass("com.bytedance.mobsec.metasec.ml.MSConfig$Builder$ICheckAppSettingsUpdated");
            Object builder = builderClass.getConstructor(String.class, String.class, int.class)
                .newInstance(config.appId, config.license, 99999);
            builderClass.getMethod("setClientType", int.class).invoke(builder, 0);
            builderClass.getMethod("setChannel", String.class).invoke(builder, config.channel);
            builderClass.getMethod("setMsSettingConfig", setting).invoke(builder, proxy(setting, (method, args) -> config.settingConfig));
            builderClass.getMethod("setFetchedDidInterface", fetchedDid).invoke(builder, proxy(fetchedDid, (method, args) -> ""));
            builderClass.getMethod("setFetchAppSettingsByKeyInterface", fetchSettings).invoke(builder,
                proxy(fetchSettings, (method, args) -> "ms_settings_prefix_8".equals(args[0]) ? "{\"type\":0,\"value\":1}" : null));
            builderClass.getMethod("setCheckAppSettingsUpdatedInterface", settingsUpdated).invoke(builder,
                proxy(settingsUpdated, (method, args) -> Boolean.TRUE));
            Object sdkConfig = builderClass.getMethod("build").invoke(builder);
            utilsClass.getMethod("init", Context.class, configClass).invoke(null, sdkContext, sdkConfig);
            manager = utilsClass.getMethod("get", String.class).invoke(null, config.appId);
            if (manager == null) return;
            getFeatureHash = managerClass.getMethod("getFeatureHash", String.class, byte[].class);
            setDeviceId = managerClass.getMethod("setDeviceID", String.class);
            setInstallId = managerClass.getMethod("setInstallID", String.class);
            try { managerClass.getMethod("report", String.class).invoke(manager, "cold_launch"); } catch (Throwable ignored) {}
            ready = true;
        } catch (Throwable ignored) {
            // Never send native exception messages, SDK values, paths or identities to logcat.
            ready = false;
        }
    }

    synchronized Map<String, String> sign(String url, byte[] body, String did, String iid) throws Exception {
        if (!ready) throw new IllegalStateException("SDK_NOT_READY");
        Protocol.validate(url, did, iid);
        setDeviceId.invoke(manager, did);
        setInstallId.invoke(manager, iid);
        for (int attempt = 0; attempt < 8; attempt++) {
            Object value = getFeatureHash.invoke(manager, url, body);
            if (value instanceof Map) {
                try { return Protocol.headers((Map<?, ?>) value); }
                catch (IllegalArgumentException incomplete) { /* A cold SDK can initially return only Neptune. */ }
            }
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            Thread.sleep(100);
        }
        throw new IllegalStateException("SIGNATURE_UNAVAILABLE");
    }

    private interface Handler { Object invoke(Method method, Object[] args) throws Throwable; }
    private static Object proxy(Class<?> type, Handler handler) {
        return Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] { type }, new InvocationHandler() {
            @Override public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
                if (method.getDeclaringClass() == Object.class) {
                    if ("hashCode".equals(method.getName())) return System.identityHashCode(proxy);
                    if ("equals".equals(method.getName())) return args != null && args.length == 1 && proxy == args[0];
                    return "OracleCallback";
                }
                return handler.invoke(method, args);
            }
        });
    }
}
