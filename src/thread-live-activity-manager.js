import {
  liveOverlayAsAgentActivity,
  ThreadLiveActivityController,
  terminalLiveActivityHasDurableFinal,
} from './thread-live-activity.js';

const text = (value) => String(value ?? '').trim();

function mentionedAgent(store) {
  const thread = store.getThreadParentMessage?.();
  const threadIds = new Set(
    [store.activeThreadId, thread?.record_id, thread?.pg_thread_id, thread?.thread_id]
      .map(text)
      .filter(Boolean),
  );
  const messages = [
    thread,
    ...(store.messages || []).filter((message) =>
      threadIds.has(text(message?.thread_id || message?.parent_message_id)),
    ),
  ]
    .filter(Boolean)
    .reverse();
  const installed = new Map(
    (store.workspaceAgents || []).map((agent) => [text(agent.agent_npub), agent]),
  );
  for (const message of messages) {
    for (const mention of message?.mentions || message?.metadata?.mentions || []) {
      if (mention?.type === 'agent' && installed.has(text(mention.npub)))
        return installed.get(text(mention.npub));
    }
  }
  const towerActivity = (store.agentActivities || []).find(
    (activity) =>
      threadIds.has(text(activity.thread_id)) && installed.has(text(activity.agent_npub)),
  );
  return installed.get(text(towerActivity?.agent_npub)) || null;
}

export const threadLiveActivityManagerMixin = {
  liveThreadActivityOverlay: null,
  liveThreadActivityContext: null,
  _threadLiveActivityController: null,

  startThreadLiveActivity() {
    if (!this.activeThreadId || !this.isTowerPgMode) {
      this.stopThreadLiveActivity();
      return;
    }
    const agent = mentionedAgent(this);
    const connection = (this.agentConnections || []).find((row) => row.id === agent?.connection_id);
    const parent = this.getThreadParentMessage?.();
    const context = {
      ownerNpub: text(this.currentWorkspace?.workspaceOwnerNpub),
      workspaceId: text(this.currentWorkspace?.workspaceId),
      towerServiceNpub: text(
        this.currentWorkspace?.towerServiceNpub || this.currentWorkspace?.serviceNpub,
      ),
      appNpub: text(this.currentWorkspace?.appNpub),
      channelId: text(parent?.channel_id || this.activeChannelId),
      threadId: text(
        parent?.pg_thread_id || parent?.thread_id || this.deckThreadTowerId || this.activeThreadId,
      ),
      agentNpub: text(agent?.agent_npub),
    };
    if (!connection || Object.values(context).some((value) => !value)) {
      this.stopThreadLiveActivity();
      return;
    }
    const key = JSON.stringify([connection.id, ...Object.values(context)]);
    if (this.liveThreadActivityContext?.key === key) return;
    this._threadLiveActivityController ??= new ThreadLiveActivityController({
      onChange: (overlay) => {
        this.liveThreadActivityOverlay = overlay;
        this.responseActivityTick = Number(this.responseActivityTick || 0) + 1;
      },
    });
    this.liveThreadActivityContext = { ...context, key };
    void this._threadLiveActivityController.open({ connection, context });
  },

  stopThreadLiveActivity() {
    this._threadLiveActivityController?.clear();
    this.liveThreadActivityOverlay = null;
    this.liveThreadActivityContext = null;
  },

  getLiveThreadActivityRow() {
    const overlay = this.liveThreadActivityOverlay;
    if (!overlay || !this.liveThreadActivityContext) return null;
    if (terminalLiveActivityHasDurableFinal(overlay, this.messages || [])) {
      this.stopThreadLiveActivity();
      return null;
    }
    return liveOverlayAsAgentActivity(overlay, this.liveThreadActivityContext);
  },

  mergeThreadLiveActivity(towerActivities = []) {
    const live = this.getLiveThreadActivityRow();
    if (!live) return towerActivities;
    return [
      ...towerActivities.filter((row) => !(
        text(row.agent_npub) === text(live.agent_npub)
        && text(row.thread_id) === text(live.thread_id)
      )),
      live,
    ].sort((left, right) => String(left.created_at || '').localeCompare(String(right.created_at || '')));
  },
};
