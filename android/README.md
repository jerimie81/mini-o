# Mini-O Android companion

This is a native Jetpack Compose client for browsing a Mini-O workspace from an
Android phone. It intentionally starts with a narrow, read-only surface:

- encrypted server URL and bearer-token storage;
- health-checked connection setup;
- approved-folder browsing with breadcrumbs and search;
- text-file viewing with scrolling;
- no file upload, remote shell, or model-management controls.

Open this directory in Android Studio and run the `app` configuration. The
project requires Android Studio's standard Gradle sync and targets API 26+.

For a same-Wi-Fi connection, configure the host project with:

```dotenv
MINI_O_HOST=0.0.0.0
REMOTE_AUTH_TOKEN=use-a-long-random-secret
ALLOWED_HOSTS=["192.168.1.20","localhost"]
```

Replace the example address in `ALLOWED_HOSTS`, start Mini-O, find the
computer's private LAN address, and enter
`http://<lan-address>:8000` and the token in the app. Use HTTPS through a
trusted reverse proxy before using it across an untrusted network. Keep
`ALLOWED_ROOTS` narrow and never expose port 8000 to the public internet.
