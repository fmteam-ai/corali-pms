import { hash, verify } from "@node-rs/argon2";

export function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: 2,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    outputLen: 32,
  });
}

export function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  return verify(hashValue, password);
}
