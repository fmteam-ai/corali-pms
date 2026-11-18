// Fake adbd for a JVM test of SelfAdbProbe: real token/signature/public-key checks with node:crypto.
import net from 'node:net'; import crypto from 'node:crypto';
const port = Number(process.argv[2]); const mode = process.argv[3] || 'accept'; // accept | reject | silent
let trusted = null; // {n,e} learned from AUTH RSAPUBLICKEY
const C = {CNXN:0x4e584e43,AUTH:0x48545541,OPEN:0x4e45504f,OKAY:0x59414b4f,CLSE:0x45534c43,WRTE:0x45545257};
const msg=(cmd,a0,a1,data=Buffer.alloc(0))=>{const h=Buffer.alloc(24);let s=0;for(const b of data)s+=b;h.writeUInt32LE(cmd,0);h.writeUInt32LE(a0>>>0,4);h.writeUInt32LE(a1>>>0,8);h.writeUInt32LE(data.length,12);h.writeUInt32LE(s>>>0,16);h.writeUInt32LE((~cmd)>>>0,20);return Buffer.concat([h,data]);};
function keyFrom(pubB64){const s=Buffer.from(pubB64,'base64');if(s.readUInt32LE(0)!==64)throw new Error('len');
  const nLE=s.subarray(8,264);const n=BigInt('0x'+Buffer.from(nLE).reverse().toString('hex'));
  const n0inv=BigInt(s.readUInt32LE(4));const R=1n<<32n; if(((n%R)*n0inv+1n)%R!==0n) throw new Error('n0inv');
  const rr=BigInt('0x'+Buffer.from(s.subarray(264,520)).reverse().toString('hex')); if(rr!==((1n<<4096n)%n)) throw new Error('rr');
  const e=s.readUInt32LE(520);
  const b64u=(x)=>{let h=x.toString(16);if(h.length%2)h='0'+h;let b=Buffer.from(h,'hex');if(b[0]&0x80)b=Buffer.concat([Buffer.from([0]),b]);return b.toString('base64url');};
  return crypto.createPublicKey({key:{kty:'RSA',n:b64u(n),e:b64u(BigInt(e))},format:'jwk'});}
function verify(key,token,sig){try{const dec=crypto.publicDecrypt({key,padding:crypto.constants.RSA_PKCS1_PADDING},sig);
  return dec.equals(Buffer.concat([Buffer.from('3021300906052b0e03021a05000414','hex'),token]));}catch{return false;}}
net.createServer(sock=>{let buf=Buffer.alloc(0);let token=crypto.randomBytes(20);let lastSig=null;
  const send=(...a)=>sock.write(msg(...a));
  sock.on('data',d=>{buf=Buffer.concat([buf,d]);while(buf.length>=24){const len=buf.readUInt32LE(12);if(buf.length<24+len)return;
    const cmd=buf.readUInt32LE(0),a0=buf.readUInt32LE(4),a1=buf.readUInt32LE(8),data=buf.subarray(24,24+len);
    let s=0;for(const b of data)s+=b; if((s>>>0)!==buf.readUInt32LE(16)||((~cmd)>>>0)!==buf.readUInt32LE(20)){console.log('BAD_CHECKSUM');process.exit(3);}
    buf=buf.subarray(24+len);
    if(cmd===C.CNXN){console.log('CNXN',data.toString().replace('\0',''));if(mode==='silent')return;send(C.AUTH,1,0,token);}
    else if(cmd===C.AUTH&&a0===2){lastSig=Buffer.from(data);
      if(trusted&&verify(trusted,token,lastSig)){console.log('SIG_OK');send(C.CNXN,0x01000001,4096,Buffer.from('device::ro.product.name=fake;\0'));}
      else{console.log('SIG_UNKNOWN');token=crypto.randomBytes(20);send(C.AUTH,1,0,token);}}
    else if(cmd===C.AUTH&&a0===3){const txt=data.toString().replace(/\0$/,'');const [b64,name]=txt.split(' ');const k=keyFrom(b64);
      console.log('PUBKEY',name,'valid-structure');
      if(mode==='reject'){send(C.AUTH,1,0,crypto.randomBytes(20));return;}
      trusted=k;setTimeout(()=>send(C.CNXN,0x01000001,4096,Buffer.from('device::\0')),1500);}
    else if(cmd===C.OPEN){console.log('OPEN',JSON.stringify(data.toString()));
      if(data.toString()==='shell:am start -n gr.hotelcorali.tv/.MainActivity --es src self-adb\0'){
        send(C.OKAY,77,a0);send(C.WRTE,77,a0,Buffer.from('Starting: Intent { cmp=gr.hotelcorali.tv/.MainActivity (has extras) }\n'));sock.amStart=true;return;}
      if(data.toString()!=='shell:pm list packages -3\0'){console.log('WRONG_COMMAND');process.exit(4);}
      send(C.OKAY,77,a0);send(C.WRTE,77,a0,Buffer.from('package:com.disney.disneyplus\npackage:gr.hotelcorali.tv\n'));
      send(C.WRTE,77,a0,Buffer.from('package:com.amazon.amazonvideo.livingroom\r\npackage:bad name\n'));}
    else if(cmd===C.OKAY){if(!sock.okays){sock.okays=0;}sock.okays++; if(sock.amStart||sock.okays===2){console.log('GOT_OKAYS');send(C.CLSE,77,1);}}
  }});
  sock.on('error',()=>{});
}).listen(port,'127.0.0.1',()=>console.log('listening',port));
