import assert from "node:assert/strict";
import test from "node:test";
import { nextImages, uploadedPhotoId } from "../lib/room-photos.ts";

const up = (id: number) => `/api/public/room-photos/${id}`;

test("keeps existing image links and appends new uploads", () => {
  assert.deepEqual(nextImages(["https://old.example/a.jpg", "/images/corali-room.jpg"], [4]), ["https://old.example/a.jpg", "/images/corali-room.jpg", up(4)]);
});

test("drops deleted uploads, duplicates and junk", () => {
  assert.deepEqual(nextImages([up(1), up(2), up(2), "", 5, null, "x.jpg"], [2]), [up(2), "x.jpg"]);
});

test("reorders across uploads and links, ignoring unknown URLs", () => {
  assert.deepEqual(nextImages([up(1), "x.jpg", up(2)], [1, 2], { order: ["x.jpg", "https://evil.example/y.jpg", up(2)] }), ["x.jpg", up(2), up(1)]);
});

test("removes one image link", () => {
  assert.deepEqual(nextImages([up(1), "x.jpg"], [1], { remove: "x.jpg" }), [up(1)]);
  assert.equal(uploadedPhotoId(up(12)), 12);
  assert.equal(uploadedPhotoId("https://x/api/public/room-photos/12"), null);
});
