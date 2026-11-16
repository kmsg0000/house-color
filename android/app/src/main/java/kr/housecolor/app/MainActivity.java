package kr.housecolor.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 우리집 외벽 색 바꾸기 — 안드로이드 앱.
 * assets/index.html 을 https://appassets.androidplatform.net 주소로 띄우는 WebView 앱이다.
 * (정식 https 주소라서 AI 키 기능의 인터넷 요청도 정상 동작)
 */
public class MainActivity extends AppCompatActivity {

    private static final String START_URL = "https://appassets.androidplatform.net/assets/index.html";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraUri;
    private ActivityResultLauncher<Intent> chooserLauncher;
    private ActivityResultLauncher<String> cameraPermLauncher;
    private ActivityResultLauncher<String> storagePermLauncher;
    private String pendingB64, pendingName;
    private final ConcurrentHashMap<String, String> httpBodies = new ConcurrentHashMap<>();

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        chooserLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (filePathCallback == null) return;
            Uri[] uris = null;
            if (result.getResultCode() == RESULT_OK) {
                Intent data = result.getData();
                if (data != null && data.getData() != null) {
                    uris = new Uri[]{data.getData()};
                } else if (data != null && data.getClipData() != null && data.getClipData().getItemCount() > 0) {
                    uris = new Uri[]{data.getClipData().getItemAt(0).getUri()};
                } else if (cameraUri != null) {
                    uris = new Uri[]{cameraUri};
                }
            }
            filePathCallback.onReceiveValue(uris);
            filePathCallback = null;
        });
        cameraPermLauncher = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> openChooser(granted));
        storagePermLauncher = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            if (granted && pendingB64 != null) {
                boolean ok = writeImage(pendingB64, pendingName);
                toast(ok ? "사진첩(갤러리)에 저장했어요" : "저장에 실패했어요");
            } else {
                toast("저장 권한이 없어 저장하지 못했어요");
            }
            pendingB64 = null;
            pendingName = null;
        });

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        setContentView(webView);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(true);
        ws.setTextZoom(100);
        ws.setMediaPlaybackRequiresUserGesture(true);
        // 같은 Wi-Fi 의 PC(ComfyUI 중계, http://192.168.x.x:8766)에 접속하기 위해 필요.
        // 앱은 사용자가 설정에 직접 입력한 주소에만 요청하며, 중계 서버는 접근 토큰을 요구한다.
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    openChooser(true);
                } else {
                    cameraPermLauncher.launch(Manifest.permission.CAMERA);
                }
                return true;
            }
        });

        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else finish();
            }
        });

        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl(START_URL);
    }

    /** 사진 고르기 창: 갤러리 + (권한이 있으면) 카메라로 찍기 */
    private void openChooser(boolean withCamera) {
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType("image/*");
        Intent chooser = Intent.createChooser(pick, "사진 고르기");
        cameraUri = null;
        if (withCamera) {
            try {
                File dir = new File(getCacheDir(), "camera");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, "photo_" + System.currentTimeMillis() + ".jpg");
                cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", f);
                Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cam});
            } catch (Exception e) {
                cameraUri = null;
            }
        }
        try {
            chooserLauncher.launch(chooser);
        } catch (Exception e) {
            if (filePathCallback != null) { filePathCallback.onReceiveValue(null); filePathCallback = null; }
            toast("사진을 고를 수 없어요");
        }
    }

    private boolean writeImage(String b64, String name) {
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/외벽색바꾸기");
                Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return false;
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os == null) return false;
                    os.write(bytes);
                }
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "외벽색바꾸기");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, name);
                try (FileOutputStream fos = new FileOutputStream(f)) { fos.write(bytes); }
                MediaScannerConnection.scanFile(this, new String[]{f.getAbsolutePath()}, new String[]{name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"}, null);
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void toast(String m) {
        runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_LONG).show());
    }

    /** 같은 Wi-Fi(사설망) 주소인지 확인 — PC 중계 서버 외의 곳으로는 요청하지 않는다 */
    private static boolean isLanHost(String host) {
        try {
            for (InetAddress a : InetAddress.getAllByName(host)) {
                if (!(a.isSiteLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress())) return false;
            }
            return true;
        } catch (Exception e) { return false; }
    }

    private static String readAll(InputStream is) throws java.io.IOException {
        if (is == null) return "";
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[65536]; int n;
        while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
        is.close();
        return bo.toString("UTF-8");
    }

    /** 웹 페이지에서 window.AndroidBridge.saveImage(base64, 파일이름) 으로 부른다 */
    class Bridge {
        /**
         * PC(ComfyUI 중계)로 HTTP 요청. WebView 의 CORS/로컬 네트워크 제한을 피하려고 네이티브로 보낸다.
         * 끝나면 window.__hcHttpDone(id, status) 를 부르고, 본문은 takeHttpBody(id) 로 가져간다.
         */
        @JavascriptInterface
        public void httpRequest(final String id, final String method, final String url, final String headersJson, final String body) {
            new Thread(() -> {
                int status; String resp;
                try {
                    URL u = new URL(url);
                    if (!"http".equals(u.getProtocol()) && !"https".equals(u.getProtocol())) throw new Exception("http 주소만 쓸 수 있어요");
                    if (!isLanHost(u.getHost())) throw new Exception("같은 Wi-Fi(사설망) 주소만 연결할 수 있어요");
                    HttpURLConnection c = (HttpURLConnection) u.openConnection();
                    c.setRequestMethod("POST".equals(method) ? "POST" : "GET");
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(20 * 60 * 1000);
                    c.setInstanceFollowRedirects(false);
                    JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                    for (Iterator<String> it = h.keys(); it.hasNext(); ) { String k = it.next(); c.setRequestProperty(k, h.getString(k)); }
                    if (body != null && !body.isEmpty() && "POST".equals(method)) {
                        byte[] b = body.getBytes(StandardCharsets.UTF_8);
                        c.setDoOutput(true);
                        c.setFixedLengthStreamingMode(b.length);
                        try (java.io.OutputStream os = c.getOutputStream()) { os.write(b); }
                    }
                    status = c.getResponseCode();
                    resp = readAll(status >= 400 ? c.getErrorStream() : c.getInputStream());
                    c.disconnect();
                } catch (Exception e) {
                    status = -1;
                    resp = "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
                }
                httpBodies.put(id, resp);
                final int st = status;
                runOnUiThread(() -> webView.evaluateJavascript("window.__hcHttpDone&&window.__hcHttpDone(" + JSONObject.quote(id) + "," + st + ")", null));
            }).start();
        }

        @JavascriptInterface
        public String takeHttpBody(String id) {
            String s = httpBodies.remove(id);
            return s == null ? "" : s;
        }

        @JavascriptInterface
        public boolean saveImage(String b64, String name) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                    && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                pendingB64 = b64;
                pendingName = name;
                runOnUiThread(() -> storagePermLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE));
                return true; // 결과는 권한 허용 후 토스트로 알림
            }
            return writeImage(b64, name);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }
}
