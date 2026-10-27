import type { IconType } from "react-icons";
import { FaBicycle, FaCar, FaChild, FaCocktail, FaCoffee, FaConciergeBell, FaDumbbell, FaShoppingBag, FaSpa, FaSwimmingPool, FaUmbrellaBeach, FaUtensils } from "react-icons/fa";
import type { DepartmentIcon as Key } from "@/lib/guest-portal-core";

const icons: Record<Key, IconType> = { bell: FaConciergeBell, bar: FaCocktail, restaurant: FaUtensils, coffee: FaCoffee, spa: FaSpa, pool: FaSwimmingPool, beach: FaUmbrellaBeach, bike: FaBicycle, car: FaCar, shop: FaShoppingBag, kids: FaChild, gym: FaDumbbell };

/** Icon of a hotel department (guest portal and PMS). */
export function DepartmentIcon({ icon }: { icon: Key | null | undefined }) {
  const I = (icon && icons[icon]) || FaConciergeBell;
  return <I aria-hidden />;
}
