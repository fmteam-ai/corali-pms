import assert from "node:assert/strict";
import test from "node:test";
import { cardAmenities, cardImages } from "../lib/room-card.ts";

test("card photos come from the first room of the type that has photos", () => {
  assert.deepEqual(cardImages([{ images: "[]", amenity_list: [] }, { images: '["/a.jpg","/b.jpg"]', amenity_list: [] }, { images: '["/c.jpg"]', amenity_list: [] }]), ["/a.jpg", "/b.jpg"]);
  assert.deepEqual(cardImages([{ images: null, amenity_list: [] }]), []);
});

test("card characteristics combine all rooms without duplicates", () => {
  const ac = { icon: "air_conditioning", el: "Κλιματισμός", en: "Air conditioning" }, sea = { icon: "sea_view", el: "Θέα θάλασσα", en: "Sea view" };
  assert.deepEqual(cardAmenities([{ images: [], amenity_list: [ac] }, { images: [], amenity_list: [ac, sea] }]), [ac, sea]);
});
