import type { Category, RuleField } from './types';
import { CATEGORY_CASH, CATEGORY_INCOME, CATEGORY_OTHER, CATEGORY_TRANSFER } from './types';

/** Default-Kategorien inkl. Schlüsselwörter. Icons sind Ionicons-Namen. */
export interface DefaultCategory extends Omit<Category, 'sortOrder'> {
  keywords: string[];
  /** Feld, gegen das die Schlüsselwörter geprüft werden (Default: any) */
  field?: RuleField;
  priority?: number;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    id: 'groceries',
    name: 'Lebensmittel',
    color: '#34A853',
    icon: 'cart-outline',
    type: 'expense',
    isSystem: false,
    keywords: [
      'REWE', 'Lidl', 'Aldi', 'Edeka', 'Netto', 'Penny', 'Kaufland', 'Norma', 'Tegut', 'Globus',
      'Alnatura', "denn's", 'Bäckerei', 'Backhaus', 'Metzgerei', 'Flink', 'Picnic', 'Hit Markt',
    ],
  },
  {
    id: 'restaurant',
    name: 'Restaurant & Lieferdienste',
    color: '#F29900',
    icon: 'restaurant-outline',
    type: 'expense',
    isSystem: false,
    keywords: [
      'Lieferando', 'Wolt', 'Uber Eats', 'McDonald', 'Burger King', 'Starbucks', 'Restaurant',
      'Pizzeria', 'KFC', 'Subway', 'Vapiano', 'Dean & David', 'Backwerk', 'Café', 'Cafe', 'Bistro', 'Imbiss',
    ],
  },
  {
    id: 'housing',
    name: 'Wohnen',
    color: '#8D6E63',
    icon: 'home-outline',
    type: 'expense',
    isSystem: false,
    keywords: [
      'Miete', 'Hausverwaltung', 'Wohnungsbau', 'Stadtwerke', 'Vattenfall', 'E.ON', 'EnBW', 'Tibber',
      'Ostrom', 'Nebenkosten', 'Rundfunk', 'Beitragsservice', 'Strom', 'Hornbach', 'OBI', 'Bauhaus',
    ],
  },
  {
    id: 'mobility',
    name: 'Mobilität',
    color: '#4285F4',
    icon: 'car-outline',
    type: 'expense',
    isSystem: false,
    keywords: [
      'DB Vertrieb', 'Deutsche Bahn', 'DB', 'Deutschlandticket', 'Aral', 'Shell', 'Esso', 'TotalEnergies',
      'JET', 'Tankstelle', 'Agip', 'BVG', 'MVG', 'HVV', 'KVB', 'VRR', 'RMV', 'Flixbus', 'Uber', 'Free Now',
      'Bolt', 'Tier', 'Lime', 'Share Now', 'Miles Mobility', 'Parkhaus', 'Parken', 'Easypark',
    ],
  },
  {
    id: 'subscriptions',
    name: 'Abos & Verträge',
    color: '#A142F4',
    icon: 'repeat-outline',
    type: 'expense',
    isSystem: false,
    keywords: [
      'Netflix', 'Spotify', 'Disney Plus', 'Disney+', 'Amazon Prime', 'Prime Video', 'Apple.com/bill',
      'iCloud', 'YouTube', 'DAZN', 'Sky Deutschland', 'Audible', 'Adobe', 'Microsoft', 'Telekom',
      'Vodafone', 'Telefonica', 'O2', '1&1', 'congstar', 'Fitness', 'McFit', 'Urban Sports', 'ChatGPT', 'OpenAI',
    ],
  },
  {
    id: 'shopping',
    name: 'Shopping',
    color: '#E8457C',
    icon: 'bag-handle-outline',
    type: 'expense',
    isSystem: false,
    keywords: [
      'Amazon', 'AMZN', 'Zalando', 'eBay', 'IKEA', 'MediaMarkt', 'Saturn', 'H&M', 'Zara', 'Primark',
      'Uniqlo', 'dm-drogerie', 'dm drogerie', 'Rossmann', 'Douglas', 'Decathlon', 'Thalia', 'Otto Payments',
    ],
  },
  {
    id: 'leisure',
    name: 'Freizeit',
    color: '#12B5CB',
    icon: 'ticket-outline',
    type: 'expense',
    isSystem: false,
    keywords: [
      'Kino', 'Cinemaxx', 'Cineplex', 'UCI', 'Eventim', 'Steam', 'PlayStation', 'Nintendo', 'Xbox',
      'Museum', 'Theater', 'Schwimmbad', 'Booking.com', 'Airbnb', 'Ticketmaster', 'Bowling', 'Konzert',
    ],
  },
  {
    id: 'health',
    name: 'Gesundheit',
    color: '#EA4335',
    icon: 'medkit-outline',
    type: 'expense',
    isSystem: false,
    keywords: ['Apotheke', 'Arztpraxis', 'Praxis', 'Zahnarzt', 'Optiker', 'Fielmann', 'Physio', 'Klinik', 'Shop Apotheke', 'DocMorris'],
  },
  {
    id: 'insurance',
    name: 'Versicherungen',
    color: '#5F7D8E',
    icon: 'shield-checkmark-outline',
    type: 'expense',
    isSystem: false,
    keywords: ['Versicherung', 'Allianz', 'HUK', 'AXA', 'ERGO', 'Generali', 'DEVK', 'R+V', 'Haftpflicht', 'Hausrat', 'Signal Iduna', 'Gothaer'],
  },
  {
    id: CATEGORY_INCOME,
    name: 'Einnahmen',
    color: '#1E8E3E',
    icon: 'trending-up-outline',
    type: 'income',
    isSystem: false,
    keywords: ['Gehalt', 'Lohn', 'Bezüge', 'Rente', 'Kindergeld', 'Zinsen', 'Dividende', 'BAföG', 'Steuererstattung'],
  },
  {
    id: CATEGORY_TRANSFER,
    name: 'Umbuchungen/Sparen',
    color: '#9AA0A6',
    icon: 'mci:piggy-bank-outline',
    type: 'transfer',
    isSystem: false,
    keywords: ['Umbuchung', 'Extra-Konto', 'Extrakonto', 'Tagesgeld', 'Sparplan', 'Depot', 'Übertrag', 'Trade Republic', 'Scalable'],
    priority: 5,
  },
  {
    id: CATEGORY_CASH,
    name: 'Bargeld',
    color: '#F6B300',
    icon: 'wallet-outline',
    type: 'transfer',
    isSystem: true,
    keywords: [
      'Bargeldauszahlung', 'Bargeldabhebung', 'Geldautomat', 'GAA', 'Barauszahlung', 'Bareinzahlung',
      'Bargeldeinzahlung', 'Einzahlautomat', 'Cash Withdrawal',
    ],
    priority: 100,
  },
  {
    id: CATEGORY_OTHER,
    name: 'Sonstiges',
    color: '#BDC1C6',
    icon: 'ellipsis-horizontal',
    type: 'expense',
    isSystem: true,
    keywords: [],
  },
];

/** Auswahl an Farben für neue Kategorien. */
export const CATEGORY_COLORS = [
  '#34A853', '#1E8E3E', '#F29900', '#F6B300', '#EA4335', '#E8457C', '#A142F4', '#7B61FF',
  '#4285F4', '#12B5CB', '#5F7D8E', '#8D6E63', '#9AA0A6', '#BDC1C6',
];

/** Auswahl an Icons (Ionicons) für neue Kategorien. */
export const CATEGORY_ICONS = [
  'cart-outline', 'restaurant-outline', 'cafe-outline', 'home-outline', 'car-outline', 'bus-outline',
  'airplane-outline', 'repeat-outline', 'bag-handle-outline', 'shirt-outline', 'ticket-outline',
  'game-controller-outline', 'medkit-outline', 'fitness-outline', 'shield-checkmark-outline',
  'trending-up-outline', 'gift-outline', 'school-outline', 'paw-outline', 'heart-outline',
  'mci:piggy-bank-outline', 'swap-horizontal-outline', 'wallet-outline', 'phone-portrait-outline', 'book-outline', 'ellipsis-horizontal',
];
