// The city vocabulary for host listings.
//
// `stays_property.city` is free text in the database, and guest destination
// search matches it with `city ILIKE '%query%'`
// (backend/internal/stays/discovery/discovery.go). Every extra spelling of the
// same place — "Lagos", "Lagos State", "LG" — splits the inventory, so a host
// picking one variant hides their listing from guests searching another. A
// closed list keeps one listing discoverable by the name guests actually type.
//
// Cities only, deliberately: no districts. The map autocomplete on the address
// field already carries Lekki / Victoria Island / Gwarinpa precision, and
// fragmenting `city` into neighbourhoods would hide a Lekki property from
// someone searching Lagos (ILIKE never matches a city it is not inside).
//
// State capitals plus the commercial and tourist markets that out-draw them.
export const PROPERTY_CITIES: string[] = [
  'Aba',
  'Abakaliki',
  'Abeokuta',
  'Abuja',
  'Ado-Ekiti',
  'Akure',
  'Asaba',
  'Awka',
  'Bauchi',
  'Benin City',
  'Birnin Kebbi',
  'Calabar',
  'Damaturu',
  'Dutse',
  'Enugu',
  'Gombe',
  'Gusau',
  'Ibadan',
  'Ilorin',
  'Jalingo',
  'Jos',
  'Kaduna',
  'Kano',
  'Katsina',
  'Lafia',
  'Lagos',
  'Lokoja',
  'Maiduguri',
  'Makurdi',
  'Minna',
  'Obudu',
  'Onitsha',
  'Osogbo',
  'Owerri',
  'Port Harcourt',
  'Sokoto',
  'Umuahia',
  'Uyo',
  'Warri',
  'Yenagoa',
  'Yola',
  'Zaria',
];
