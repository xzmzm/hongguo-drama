// SPDX-License-Identifier: GPL-3.0-only
package com.sign.oracle;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Base64;
import java.io.BufferedInputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** One bounded JSON line per localhost connection; requests/signatures are never written to disk. */
public final class SignService extends Service {
    private final Set<Socket> clients = Collections.newSetFromMap(new ConcurrentHashMap<Socket, Boolean>());
    private volatile boolean running;
    private volatile ServerSocket server;
    private volatile ThreadPoolExecutor workers;
    private volatile Metasec metasec;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public synchronized int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel("oracle", "USB phone signing", NotificationManager.IMPORTANCE_LOW));
        Notification notification = new Notification.Builder(this, "oracle").setContentTitle("USB phone signing")
            .setContentText("Local desktop bridge is running").setSmallIcon(android.R.drawable.ic_lock_idle_lock).build();
        startForeground(1, notification);
        if (!running) {
            running = true;
            new Thread(this::serve, "oracle-listener").start();
        }
        return START_STICKY;
    }

    private void serve() {
        try {
            metasec = Metasec.get(this);
            if (!running) return;
            workers = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<Runnable>(8));
            server = new ServerSocket(Protocol.PORT, 8, InetAddress.getByName("127.0.0.1"));
            while (running) {
                Socket client = server.accept();
                clients.add(client);
                try { workers.execute(() -> handle(client)); }
                catch (RuntimeException busy) { close(client); }
            }
        } catch (Exception ignored) {
            // No request data, credentials, SDK diagnostics or device IDs in logcat.
        } finally { running = false; closeResources(); stopSelf(); }
    }

    private void handle(Socket socket) {
        try (Socket client = socket; OutputStream output = client.getOutputStream()) {
            client.setTcpNoDelay(true);
            client.setSoTimeout(1000);
            String response;
            try {
                String line = Protocol.readLine(new BufferedInputStream(client.getInputStream()), Protocol.MAX_LINE,
                    System.nanoTime() + TimeUnit.SECONDS.toNanos(5));
                JSONObject request = new JSONObject(line);
                if ("ping".equals(request.optString("op"))) {
                    response = new JSONObject().put("ready", metasec.isReady())
                        .put("err", metasec.isReady() ? JSONObject.NULL : "SDK_NOT_READY").toString();
                } else {
                    String url = request.getString("url"), did = request.getString("did"), iid = request.getString("iid");
                    Protocol.validate(url, did, iid);
                    String encoded = request.optString("body_b64", "");
                    if (encoded.length() > ((Protocol.MAX_BODY + 2) / 3) * 4) throw new IllegalArgumentException();
                    byte[] body = encoded.isEmpty() ? null : Base64.decode(encoded, Base64.NO_WRAP);
                    if (body != null && body.length > Protocol.MAX_BODY) throw new IllegalArgumentException();
                    Map<String, String> headers = metasec.sign(url, body, did, iid);
                    response = new JSONObject().put("headers", new JSONObject(headers)).toString();
                }
            } catch (Throwable ignored) {
                response = "{\"error\":\"SIGNING_UNAVAILABLE\"}";
            }
            output.write((response + "\n").getBytes(StandardCharsets.UTF_8));
            output.flush();
        } catch (Exception ignored) {
            // The desktop may cancel or disconnect at any point.
        } finally { clients.remove(socket); }
    }

    private void close(Socket client) {
        clients.remove(client);
        try { client.close(); } catch (Exception ignored) {}
    }

    private synchronized void closeResources() {
        try { if (server != null) server.close(); } catch (Exception ignored) {}
        if (workers != null) workers.shutdownNow();
        for (Socket client : clients) close(client);
    }

    @Override public void onDestroy() {
        running = false;
        closeResources();
        super.onDestroy();
    }
}
