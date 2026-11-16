JVM test of `SelfAdbProbe` against a fake adbd that checks the real ADB framing, RSA signature and public-key encoding:

    javac --release 8 -d /tmp/cls android-tv/src/gr/hotelcorali/tv/SelfAdbProbe.java android-tv/test/ProbeTest.java
    node android-tv/test/fake-adbd.mjs 5611 accept &      # modes: accept | reject | silent
    java -cp /tmp/cls gr.hotelcorali.tv.ProbeTest /tmp/key 5611 5000   # 1st: PASS trusted=false (prompt)
    java -cp /tmp/cls gr.hotelcorali.tv.ProbeTest /tmp/key 5611 5000   # 2nd: PASS trusted=true
