// SPDX-License-Identifier: GPL-3.0-only
package com.sign.oracle;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/** Shared wire validation; does not read, log or persist a phone identifier. */
final class Protocol {
    static final int PORT = 8762;
    static final int MAX_BODY = 1024 * 1024;
    static final int MAX_LINE = 2 * 1024 * 1024;
    private static final Set<String> REQUIRED = new HashSet<>(Arrays.asList(
        "x-argus", "x-gorgon", "x-helios", "x-khronos", "x-ladon", "x-medusa"));

    static void validate(String url, String did, String iid) throws Exception {
        URI parsed = new URI(url);
        if (!"https".equals(parsed.getScheme()) || !"api5-normal-sinfonlineb.fqnovel.com".equals(parsed.getHost())
            || parsed.getRawUserInfo() != null || parsed.getRawFragment() != null
            || (parsed.getPort() != -1 && parsed.getPort() != 443)
            || !("/reading/bookapi/video_tab/multi_video_model/v1/".equals(parsed.getRawPath())
                || "/novel/player/multi_video_model/v1/".equals(parsed.getRawPath()))
            || did == null || iid == null || !did.matches("[0-9]{1,30}") || !iid.matches("[0-9]{1,30}")
            || parsed.getRawQuery() == null) throw new IllegalArgumentException("Invalid signing request");
        Map<String, String> identity = new HashMap<>();
        for (String part : parsed.getRawQuery().split("&")) {
            String[] pair = part.split("=", 2);
            String key = URLDecoder.decode(pair[0], "UTF-8");
            if (!"device_id".equals(key) && !"iid".equals(key)) continue;
            if (pair.length != 2 || identity.containsKey(key)) throw new IllegalArgumentException("Invalid signing request");
            identity.put(key, URLDecoder.decode(pair[1], "UTF-8"));
        }
        if (!did.equals(identity.get("device_id")) || !iid.equals(identity.get("iid")))
            throw new IllegalArgumentException("Invalid signing request");
    }

    static Map<String, String> headers(Map<?, ?> value) {
        Map<String, String> result = new TreeMap<>();
        for (Map.Entry<?, ?> entry : value.entrySet()) {
            if (!(entry.getKey() instanceof String)) continue;
            String key = ((String) entry.getKey()).toLowerCase(Locale.ROOT);
            if (!REQUIRED.contains(key) && !"x-neptune".equals(key)) continue;
            Object item = entry.getValue();
            if (!(item instanceof String) || ((String) item).isEmpty() || ((String) item).length() > 16384
                || !((String) item).matches("[\\x20-\\x7e]+") || result.containsKey(key))
                throw new IllegalArgumentException("Invalid signature response");
            result.put(key, (String) item);
        }
        if (!result.keySet().containsAll(REQUIRED) || !result.get("x-khronos").matches("[0-9]{10}"))
            throw new IllegalArgumentException("Incomplete signature response");
        return result;
    }

    static String readLine(InputStream input, int limit, long deadlineNanos) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        while (true) {
            if (System.nanoTime() > deadlineNanos) throw new InterruptedIOException("Request timeout");
            int next = input.read();
            if (next == -1) throw new IOException("Incomplete request");
            if (next == '\n') return new String(output.toByteArray(), StandardCharsets.UTF_8);
            if (output.size() >= limit) throw new IOException("Request too large");
            output.write(next);
        }
    }
}
