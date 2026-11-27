// What the Mini App gets from the server (/app/api/state + /app/api/state-more, crm/src/app.ts) and keeps in its store.
// Gradual: the fields the app relies on are typed; `Open` keeps every other field reachable (as `any`) until it gets a type.
import type {
  DealsRow, DirectoryRow, DocumentsRow, DraftsRow, HouseContactsRow, IssuesRow, ListingContactsRow, ListingsRow, PlacesRow,
  ThreadsRow, ViewingsRow, VotesRow,
} from './rows.js';

/** Fields not typed yet: still reachable, typed `any`. */
export type Open = { [key: string]: any };
/** Text in several languages: { ru, en, … }. */
export type Tr = { [lang: string]: string };

export type Role = 'owner' | 'member' | 'viewer' | 'guest';
export type Lang = 'ru' | 'en';

export interface Animal extends Open { slug?: string; name?: Tr; bg_light?: string; bg_dark?: string }
export interface Member extends Open { user_id: string; name: string; role: Role; animal: Animal | null }
export interface AppUser extends Open { id: string; display_name: string; lang: string; can_create: boolean }
export interface SearchSummary extends Open { id: string; title: string; region: string; country: string; stage?: Open | null; counts?: Open }
export interface Me extends Open { role: Role; animal: Animal | null; reveal_seen: boolean; notify: boolean; digest: boolean; surf: boolean; surf_auto: boolean }

/** A photo with the URL the app shows (`src`). */
export interface Photo extends Open { src?: string; url?: string }
/** A listing with its JSON columns parsed. */
export interface Listing extends Omit<ListingsRow, 'includes' | 'fields' | 'photos' | 'checks' | 'travel' | 'location' | 'flood' | 'tg_message_id'>, Open {
  includes: any; fields: Open; photos: Photo[]; checks: Open | null; travel: Open | null; flood: Open | null; location_score: number | null;
}
export interface Vote extends Partial<VotesRow>, Open { listing_id: string; user_id: string; decision: string }
export interface Viewing extends Omit<ViewingsRow, 'photos'>, Open { photos?: Photo[] }
export interface Thread extends ThreadsRow, Open {}
export interface Draft extends DraftsRow, Open {}
export interface ListingContact extends ListingContactsRow, Open {}
export interface Deal extends Omit<DealsRow, 'data'>, Open { data: Open }
export interface Issue extends IssuesRow, Open {}
export interface HouseContact extends Partial<HouseContactsRow>, Open {}
export interface Doc extends Omit<Partial<DocumentsRow>, 'summary'>, Open { summary: Open | null }
export interface DirEntry extends Partial<DirectoryRow>, Open {}
export interface Place extends Partial<PlacesRow>, Open {}
/** A bike with its JSON columns parsed (bikeView in crm/src). */
export interface Bike extends Open { id: string }
export interface FeedItem extends Open { type: 'event' | 'message'; id: string; at: string }

/** /app/api/state, merged with /app/api/state-more. */
export interface State extends Open {
  user: AppUser;
  searches: SearchSummary[];
  search: SearchSummary & { invite_link: string | null };
  me: Me;
  members: Member[];
  listings: Listing[];
  votes: Vote[];
  /** listing id → the ratings of that home */
  ratings: { [listingId: string]: Open };
  viewings: Viewing[];
  routes: { [day: string]: string };
  drafts: Draft[];
  threads: Thread[];
  listing_contacts: ListingContact[];
  channels: Open[];
  deal: Deal | null;
  dates: Open[];
  path: Open | null;
  money: Open | null; issues: Issue[]; house_contacts: HouseContact[]; documents: Doc[]; onsite: Open[]; onsite_photos: Open[];
  moveout: Open | null; relet: Open | null; power: Open | null; directory: DirEntry[]; visas: Open[]; places: Place[]; bikes: Bike[];
  scans: Open[]; items: Open | null;
  bot_username: string | null;
  renewal: Open | null;
  guests: Open[];
  guest_drafts: Open[];
  guide_ready: boolean;
  feed: FeedItem[];
  counts: { new: number; drafts: number; replies_24h: number };
  agent_last_seen: string | null;
  agent_client: string | null;
  agent_version: string | null;
  photo_token: string | null;
}

/** /art/regions.json (scripts/copy-art.mjs): every region pack the app knows. */
export interface Region extends Open { name: Tr; tz?: string; currency?: string; areas?: { [id: string]: Open }; sub?: { [city: string]: Open }; islands?: string[] }
export type Regions = { [country: string]: Region };

/** A bottom sheet: which one and its argument. */
export interface Sheet { kind: string; arg?: any }
/** One button on a toast (an undo). */
export interface ToastAct { label: string; icon?: string; run: () => void }

/** The app's one store (core/store.ts). The open keys are short-lived UI hints set by screens. */
export interface Store extends Open {
  data: State | null;
  regions: Regions | null;
  error: (Error & { status?: number; code?: string }) | null;
  loading: boolean;
  toast: string | null;
  toastAct?: ToastAct | null;
  sheet: Sheet | null;
  planDay: string | null;
}
