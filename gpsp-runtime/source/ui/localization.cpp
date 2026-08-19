#include "localization.h"

#include <3ds/services/cfgu.h>
#include <string.h>

static Language currentLanguage = Language::English;

static bool languageFromSystem(void) {
    Result result = cfguInit();
    if (R_FAILED(result)) return false;
    u8 systemLanguage = CFG_LANGUAGE_EN;
    result = CFGU_GetSystemLanguage(&systemLanguage);
    cfguExit();
    if (R_FAILED(result)) return false;
    // Only English is fully supported today; the table layout is ready for
    // additional languages once translations are available.
    (void) systemLanguage;
    return true;
}

bool localizationInit(void) {
    currentLanguage = Language::English;
    languageFromSystem();
    return true;
}

void localizationShutdown(void) {
    currentLanguage = Language::English;
}

Language localizationCurrentLanguage(void) {
    return currentLanguage;
}

static const char* english(LocalizedString key) {
    switch (key) {
    case LS_EMERALD_ONLINE: return "EMERALD ONLINE";
    case LS_ONLINE_USERS_READ_ONLY: return "ONLINE USERS - READ ONLY";
    case LS_CHAT: return "CHAT";
    case LS_PARTY_LOCAL_ONLY: return "PARTY - LOCAL ONLY";
    case LS_BAG_LOCAL_ONLY: return "BAG - LOCAL ONLY";
    case LS_MAP_TRAINER_RADAR: return "MAP & TRAINER RADAR";
    case LS_PLAYER_STATS_AND_CONSENT: return "PLAYER STATS & CONSENT";
    case LS_TELEPORT: return "TELEPORT";
    case LS_SYSTEM_UPDATE: return "SYSTEM UPDATE";

    case LS_Y_ARROW: return "Y >";

    case LS_WAITING_EMERALD_MEMORY_PARTY: return "Waiting for Emerald memory...";
    case LS_Y_BAG: return "Y  BAG";
    case LS_LEVEL_FORMAT: return "Lv%u";

    case LS_ONLINE: return "ONLINE";
    case LS_CONNECTING: return "CONNECTING";
    case LS_RETRYING: return "RETRYING";
    case LS_OFFLINE: return "OFFLINE";

    case LS_ID_FORMAT: return "ID %s";
    case LS_FPS_FORMAT: return "%u FPS";
    case LS_MAP_TILE_FORMAT: return "MAP %u-%u   TILE %d,%d";
    case LS_WAITING_OVERWORLD: return "Waiting for the overworld...";
    case LS_RECOVERY_WRITE_DOWN_FORMAT: return "RECOVERY %s  WRITE THIS DOWN";
    case LS_VERSION_HOST_PORT_FORMAT: return "v%s %s:%u";
    case LS_TAP_PROFILE_PAIR_BROWSER: return "TAP PROFILE TO PAIR BROWSER";

    case LS_NETWORK_DIAGNOSTIC: return "NETWORK DIAGNOSTIC";
    case LS_NETWORK_DIAGNOSTIC_DETAIL_FORMAT: return "E%d  %s  (STAGE %d)";
    case LS_TLS_RESULT_FORMAT: return "TLS RESULT  %d";
    case LS_VERIFY_CLOCK_FORMAT: return "VERIFY %08lX   CLOCK +%ds";
    case LS_LOG_PATH_LABEL: return "LOG /3ds/emerald-online-3ds/gpsp-debug.log";

    case LS_NEARBY_ONLINE_FORMAT: return "NEARBY %d / ONLINE %u";
    case LS_TAP_FOR_ALL_USERS: return "Tap for all users";
    case LS_TAP_FOR_MESSAGES: return "Tap for messages";

    case LS_WAVE: return "WAVE";
    case LS_BATTLE: return "BATTLE";
    case LS_TRADE: return "TRADE";
    case LS_GG: return "GG";
    case LS_HI: return "HI";
    case LS_EXCLAMATION: return "!";
    case LS_ANGLED_BRACKETS: return "<>";

    case LS_COULD_NOT_LOAD_EMERALD_GBA: return "Could not load emerald.gba";
    case LS_3DS_EMERALD_ONLINE_3DS: return "/3ds/emerald-online-3ds/";

    case LS_WAITING_VALID_EMERALD_MEMORY: return "Waiting for valid Emerald memory...";
    case LS_LOCAL_ONLY_MONEY_FORMAT: return "LOCAL ONLY   MONEY $%lu";
    case LS_POCKET_IS_EMPTY: return "Pocket is empty";
    case LS_PREVIOUS: return "PREVIOUS";
    case LS_NEXT: return "NEXT";
    case LS_POCKET_ITEMS: return "ITEMS";
    case LS_POCKET_KEY: return "KEY";
    case LS_POCKET_BALLS: return "BALLS";
    case LS_POCKET_TM_HM: return "TM/HM";
    case LS_POCKET_BERRY: return "BERRY";
    case LS_UNKNOWN_ITEM: return "UNKNOWN ITEM";

    case LS_WAITING_EMERALD_OVERWORLD: return "Waiting for the Emerald overworld...";
    case LS_PLAYER_MARKER: return "P";
    case LS_LOCAL_RADAR: return "LOCAL RADAR";
    case LS_MAP_FORMAT: return "MAP %u-%u";
    case LS_TILE_FORMAT: return "TILE %d,%d";
    case LS_FACING_FORMAT: return "FACING %s";
    case LS_NEARBY_FORMAT: return "NEARBY %d";
    case LS_NO_TRAINERS: return "No trainers";

    case LS_PRIVATE_BY_DEFAULT: return "PRIVATE BY DEFAULT - NO ID, PARTY, ITEMS, SAVE OR ROM";
    case LS_LOCAL_SEEN_CAUGHT_BADGES_FORMAT: return "LOCAL: SEEN %u  CAUGHT %u  BADGES %u/8";
    case LS_POKEDEX_SEEN: return "POKEDEX SEEN";
    case LS_POKEDEX_CAUGHT: return "POKEDEX CAUGHT";
    case LS_BADGE_COUNT: return "BADGE COUNT";
    case LS_FRONTIER_STREAKS: return "FRONTIER STREAKS";
    case LS_ON: return "ON";
    case LS_OFF: return "OFF";
    case LS_UPLOADS_OFF_TAP_ENABLE: return "UPLOADS OFF - TAP ENABLE";
    case LS_ENABLE_UPLOAD_EXPLICIT_CONSENT: return "ENABLE UPLOAD - EXPLICIT CONSENT";
    case LS_SYNC_NOW: return "SYNC NOW";
    case LS_DELETE_ALL_STATS: return "DELETE ALL STATS";
    case LS_SYNC_SENT_COMMUNITY_SUBMITTED: return "SYNC SENT - COMMUNITY-SUBMITTED";
    case LS_CONSENT_SAVED_ON_SERVER: return "CONSENT SAVED ON SERVER";
    case LS_COULD_NOT_SAVE_STATS_CFG: return "COULD NOT SAVE STATS.CFG";
    case LS_NOT_ENABLED_NO_DATA_UPLOADED: return "NOT ENABLED - NO DATA UPLOADED";
    case LS_CONSENT_SAVED_SYNCING: return "CONSENT SAVED - SYNCING";
    case LS_FIELD_ENABLED_SYNCING: return "FIELD ENABLED - SYNCING";
    case LS_FIELD_DISABLED_SERVER_DATA_REMOVED: return "FIELD DISABLED - SERVER DATA REMOVED";
    case LS_DELETE_CANCELLED: return "DELETE CANCELLED";
    case LS_DELETE_SENT_UPLOADS_OFF: return "DELETE SENT - UPLOADS OFF";
    case LS_CONNECT_ONLINE_TO_SYNC: return "CONNECT ONLINE TO SYNC";
    case LS_WAITING_FOR_VALID_SAVE_MEMORY: return "WAITING FOR VALID SAVE MEMORY";
    case LS_SCORES_SYNCED: return "SCORES SYNCED";
    case LS_SENT_VALUES_UNDER_REVIEW: return "SENT - SOME VALUES UNDER REVIEW";

    case LS_GLOBAL_MAP_TILE_POSITIONS_FORMAT: return "GLOBAL MAP / TILE POSITIONS - %u ONLINE";
    case LS_TRAINER: return "TRAINER";
    case LS_TYPE: return "TYPE";
    case LS_MAP_TILE: return "MAP/TILE";
    case LS_WAITING: return "WAITING";
    case LS_WAITING_ONLINE_ROSTER: return "Waiting for the online roster...";
    case LS_CONNECT_ONLINE_VIEW_USERS: return "Connect online to view users";

    case LS_MAP_CHAT: return "MAP CHAT";
    case LS_GLOBAL_CHAT: return "GLOBAL CHAT";
    case LS_GLOBAL_MSG_SESSION_UTC_TAP_FORMAT: return "%u GLOBAL MSG - SESSION ONLY - UTC - TAP TO READ";
    case LS_MSG_MAP_UTC_TAP_FORMAT: return "%u MSG - MAP %u-%u - UTC - TAP TO READ";
    case LS_CURRENT_MAP_SESSION_UTC: return "CURRENT MAP - SESSION ONLY - TIMES ARE UTC";
    case LS_BACK: return "BACK";
    case LS_NO_GLOBAL_MESSAGES_SESSION: return "No global messages this session";
    case LS_NO_MESSAGES_MAP: return "No messages on this map yet";
    case LS_WAITING_OVERWORLD_CHAT: return "Waiting for the overworld...";
    case LS_COMPOSE: return "COMPOSE";

    case LS_TELEPORT_ALL: return "ALL";
    case LS_TELEPORT_GYMS: return "GYMS";
    case LS_TELEPORT_LOCS: return "LOCS";
    case LS_TELEPORT_PLAYERS: return "PLAYERS";
    case LS_TELEPORT_MOM: return "MOM";
    case LS_TELEPORT_CUSTOM: return "CUSTOM";
    case LS_WAITING_DESTINATIONS: return "Waiting for destinations...";
    case LS_CONNECT_ONLINE_TELEPORT: return "Connect online to teleport";
    case LS_TELEPORT_BUTTON: return "TELEPORT";
    case LS_ADD_CUSTOM: return "ADD CUSTOM";
    case LS_INVALID_FORMAT_USE_MAP_MAP_X_Y: return "INVALID FORMAT - USE map-map,x,y";
    case LS_COORDINATES_OUT_OF_RANGE: return "COORDINATES OUT OF RANGE";
    case LS_CUSTOM_DEST_SENT_FOR_APPROVAL: return "CUSTOM DEST SENT FOR APPROVAL";
    case LS_FAILED_TO_SEND_CUSTOM_DEST: return "FAILED TO SEND CUSTOM DEST";
    case LS_WARP_FAILED_FORMAT: return "WARP FAILED: %.30s";
    case LS_WARP_FAILED_BAD_COORDS: return "WARP FAILED: BAD COORDS";
    case LS_WARPED_TO_FORMAT: return "WARPED TO %d,%d";

    case LS_CURRENT_VERSION_FORMAT: return "CURRENT VERSION: %s";
    case LS_LATEST_VERSION_FORMAT: return "LATEST: %s";
    case LS_KB_FORMAT: return "%llu / %llu KB";
    case LS_CHECK_FOR_UPDATE: return "CHECK FOR UPDATE";
    case LS_DOWNLOAD: return "DOWNLOAD";
    case LS_INSTALL: return "INSTALL";
    case LS_EXIT_RELAUNCH: return "EXIT & RELAUNCH";
    case LS_CHECKING_FOR_UPDATE: return "CHECKING FOR UPDATE...";
    case LS_UPDATE_CHECK_FAILED: return "UPDATE CHECK FAILED";
    case LS_UPDATE_RESPONSE_INVALID: return "UPDATE RESPONSE INVALID";
    case LS_UP_TO_DATE_FORMAT: return "UP TO DATE - %s";
    case LS_UPDATE_AVAILABLE_FORMAT: return "UPDATE %s AVAILABLE";
    case LS_DOWNLOADING: return "DOWNLOADING...";
    case LS_DOWNLOAD_FAILED: return "DOWNLOAD FAILED";
    case LS_VERIFYING: return "VERIFYING...";
    case LS_HASH_MISMATCH: return "HASH MISMATCH";
    case LS_READY_TAP_INSTALL: return "READY - TAP INSTALL";
    case LS_INSTALLING: return "INSTALLING...";
    case LS_INSTALL_FAILED: return "INSTALL FAILED";
    case LS_DONE_EXIT_RELAUNCH: return "DONE - EXIT & RELAUNCH";

    case LS_LINK_SPIKE_DISABLED: return "LINK SPIKE DISABLED";
    case LS_LINK_RECONNECTING: return "LINK RECONNECTING";
    case LS_JOIN_SENT: return "LINK JOIN SENT";
    case LS_LINK_WAITING_FORMAT: return "LINK %s WAITING";
    case LS_LINK_ACTIVE_BACKUP_OK_FORMAT: return "LINK %s ACTIVE - BACKUP OK";
    case LS_LINK_BLOCKED_SAVE_BACKUP_FAILED: return "LINK BLOCKED - SAVE BACKUP FAILED";
    case LS_LINK_BLOCKED_BY_CORE: return "LINK BLOCKED BY CORE";
    case LS_LINK_PEER_DISCONNECTED: return "LINK PEER DISCONNECTED";
    case LS_LINK_SESSION_ENDED: return "LINK SESSION ENDED";
    case LS_LINK_STATUS_TX_RX_FORMAT: return "%.36s TX%u RX%u";
    case LS_SERVER_FORMAT: return "SERVER: %.34s";

    case LS_BROWSER_PAIRED: return "BROWSER PAIRED";
    case LS_PAIRING_CODE_EXPIRED: return "PAIRING CODE EXPIRED";
    case LS_INVALID_PAIRING_CODE: return "INVALID PAIRING CODE";
    case LS_PAIRING_APPROVAL_SENT: return "PAIRING APPROVAL SENT";
    case LS_PAIRING_SEND_FAILED: return "PAIRING SEND FAILED";

    case LS_HINT_CUSTOM_DESTINATION_NAME: return "Custom destination name";
    case LS_HINT_MAPGROUP_MAPNUM_X_Y: return "mapGroup-mapNum,x,y";
    case LS_HINT_BROWSER_CODE: return "Enter the 8-character browser code";
    case LS_HINT_TYPE_YES_UPLOAD: return "Type YES: upload Seen, Caught, Badges, Frontier";
    case LS_HINT_TYPE_DELETE_ERASE: return "Type DELETE to erase all uploaded stats";

    case LS_QUEST_LOG: return "QUEST LOG";
    case LS_NO_QUESTS: return "No quests available";
    case LS_TALK: return "TALK";
    case LS_HARVEST: return "HARVEST";
    case LS_ACCEPT_QUEST: return "ACCEPT QUEST";
    case LS_QUEST_COMPLETED: return "QUEST COMPLETED";
    case LS_QUEST_REWARD_TITLE: return "Title unlocked:";
    case LS_NPC_DIALOGUE_TITLE: return "NPC DIALOGUE";
    case LS_QUEST_ACCEPTED: return "Quest accepted!";

    case LS_TITLE_LOG: return "TITLE LOG";
    case LS_FRIENDS_LIST: return "FRIENDS";
    case LS_NO_TITLES: return "No titles unlocked";
    case LS_NO_FRIENDS: return "No friends yet";
    case LS_EQUIPPED: return "EQUIPPED";

    case LS_GUILD: return "GUILD";
    case LS_NO_GUILD: return "Not in a guild";

    case LS_COUNT: break;
    }
    return "";
}

const char* localize(LocalizedString key) {
    if (key < 0 || key >= LS_COUNT) return "";
    switch (currentLanguage) {
    case Language::English:
    default:
        return english(key);
    }
}
