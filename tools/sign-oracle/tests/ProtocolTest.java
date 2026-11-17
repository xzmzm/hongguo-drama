// SPDX-License-Identifier: GPL-3.0-only
package com.sign.oracle;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Fabricated request identities and headers only; no real phone or SDK required. */
public final class ProtocolTest {
    private static int checks;
    private static final String QUERY = "?device_id=1001&iid=2002&text=a%20b%2Bz";
    private static final String HOST = "https://api5-normal-sinfonlineb.fqnovel.com";
    private static final String TAB = "/reading/bookapi/video_tab/multi_video_model/v1/";
    private interface Action { void run() throws Exception; }
    private static void rejects(Action action) throws Exception {
        try { action.run(); } catch (Exception expected) { checks++; return; }
        throw new AssertionError("Invalid input was accepted");
    }
    private static void check(boolean value) { if (!value) throw new AssertionError("Protocol invariant failed"); checks++; }
    private static Map<String, String> headers() {
        Map<String, String> value = new HashMap<>();
        for (String name : new String[] { "Argus", "Gorgon", "Helios", "Ladon", "Medusa" }) value.put("X-" + name, "fixture-" + name);
        value.put("X-Khronos", "1700000000"); return value;
    }
    private static String line(String value, int limit) throws Exception {
        return Protocol.readLine(new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8)), limit,
            System.nanoTime() + TimeUnit.SECONDS.toNanos(2));
    }

    public static void main(String[] args) throws Exception {
        Protocol.validate(HOST + TAB + QUERY, "1001", "2002"); checks++;
        Protocol.validate(HOST + "/novel/player/multi_video_model/v1/" + QUERY, "1001", "2002"); checks++;
        for (String url : new String[] {
            "http://api5-normal-sinfonlineb.fqnovel.com" + TAB + QUERY,
            "https://api5-normal-sinfonlineb.fqnovel.com.evil.example" + TAB + QUERY,
            "https://user@api5-normal-sinfonlineb.fqnovel.com" + TAB + QUERY,
            "https://api5-normal-sinfonlineb.fqnovel.com:8762" + TAB + QUERY,
            HOST + "/unrelated/" + QUERY, HOST + TAB + QUERY + "#fragment",
            HOST + TAB + QUERY + "&device_id=1001", HOST + TAB + QUERY + "&%69id=2002",
            HOST + TAB + "?device_id=1001", HOST + TAB + "?device_id=wrong&iid=2002",
        }) rejects(() -> Protocol.validate(url, "1001", "2002"));
        rejects(() -> Protocol.validate(HOST + TAB + QUERY, "1001", "9999"));
        rejects(() -> Protocol.validate(HOST + TAB + QUERY, "1001", null));
        Map<String, String> nativeHeaders = headers();
        nativeHeaders.put("Cookie", "fixture-cookie"); nativeHeaders.put("Authorization", "fixture-auth");
        Map<String, String> clean = Protocol.headers(nativeHeaders);
        check(clean.size() == 6 && "fixture-Argus".equals(clean.get("x-argus")) && !clean.containsKey("Cookie"));
        Map<String, String> duplicate = headers(); duplicate.put("x-argus", "duplicate");
        rejects(() -> Protocol.headers(duplicate));
        Map<String, String> incomplete = headers(); incomplete.remove("X-Medusa");
        rejects(() -> Protocol.headers(incomplete));
        for (String bad : new String[] { "", "bad\r\nCookie: fixture", "bad\u0000", "bad\u0100", new String(new char[16385]).replace('\0', 'x') }) {
            Map<String, String> invalid = headers(); invalid.put("X-Argus", bad);
            rejects(() -> Protocol.headers(invalid));
        }
        check("four".equals(line("four\nignored", 4)));
        rejects(() -> line("longer\n", 4));
        rejects(() -> line("incomplete", 20));
        rejects(() -> Protocol.readLine(new ByteArrayInputStream(new byte[] { 10 }), 20, System.nanoTime() - 1));
        System.out.println("PASS " + checks + " oracle protocol checks (synthetic fixtures only)");
    }
}
