// SPDX-License-Identifier: GPL-3.0-only
package com.sign.oracle;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONObject;

/** SDK inputs are supplied locally at build time, never embedded in shared source. */
final class OracleConfig {
    final String targetPackage, appId, license, settingConfig, channel;

    private OracleConfig(JSONObject value) throws Exception {
        Set<String> allowed = new HashSet<>(Arrays.asList("target_package", "app_id", "license", "setting_config", "channel"));
        for (Iterator<String> keys = value.keys(); keys.hasNext();) {
            if (!allowed.contains(keys.next())) throw new IllegalArgumentException("Unsupported SDK configuration field");
        }
        targetPackage = required(value, "target_package");
        appId = required(value, "app_id");
        license = required(value, "license");
        settingConfig = required(value, "setting_config");
        channel = required(value, "channel");
        if (!targetPackage.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")
            || !appId.matches("[0-9]{1,10}")) throw new IllegalArgumentException("Invalid SDK configuration");
    }

    private static String required(JSONObject value, String name) throws Exception {
        Object item = value.get(name);
        if (!(item instanceof String) || ((String) item).trim().isEmpty() || ((String) item).length() > 16384)
            throw new IllegalArgumentException("Incomplete SDK configuration");
        return (String) item;
    }

    static OracleConfig load(Context context) throws Exception {
        try (InputStream input = context.getAssets().open("oracle-config.json")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (bytes.size() + count > 64 * 1024) throw new IllegalArgumentException("SDK configuration too large");
                bytes.write(buffer, 0, count);
            }
            return new OracleConfig(new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8)));
        }
    }
}
