package gr.hotelcorali.tv;
import java.io.File;
public class ProbeTest {
  public static void main(String[] a) throws Exception {
    File dir = new File(a[0]); int port = Integer.parseInt(a[1]); int wait = Integer.parseInt(a[2]);
    SelfAdbProbe.Result r = SelfAdbProbe.run(dir, "127.0.0.1", port, wait);
    System.out.println("RESULT " + r.status + " trusted=" + r.keyAlreadyTrusted + " pkgs=" + r.packages + " :: " + r.detail);
  }
}
