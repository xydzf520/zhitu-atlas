<template>
  <main ref="screen" class="career-dashboard" :class="{ 'communication-page': view === 'replies' }">
    <header class="dash-header">
      <div>
        <h1>
          {{
            view === 'sync'
              ? '同步结果与诊断'
              : view === 'companies'
                ? '企业与进展'
                : view === 'replies'
                  ? '沟通中心'
                  : '全景总览'
          }}
        </h1>
      </div>
      <div class="header-actions">
        <span class="current-date"
          >{{ dayLabel
          }}<small>{{ state.profile.name || '我的求职空间' }} · {{ accountLabel }}</small></span
        ><button class="icon-button" @click="toggleFullscreen" aria-label="切换大屏全屏">⛶</button
        ><button class="primary-button" :disabled="loading" @click="load()">
          {{ loading ? '读取中…' : '刷新' }} <span>↻</span>
        </button>
      </div>
    </header>
    <SetupGuide v-if="view === 'overview'" compact />
    <div v-if="view !== 'replies'" class="dashboard-nav">
      <div class="workspace-location">
        {{
          view === 'overview'
            ? '机会分布与跟进概况'
            : view === 'sync'
              ? '同步范围、缺失原因与处理结果'
              : view === 'companies'
                ? '集中管理每一个目标岗位'
                : liveStatus.replyLabel
        }}
      </div>
      <div class="nav-status">
        <span :class="['status-dot', { connected: sourceConnected }]" />{{ liveStatus.sourceLabel
        }}<button @click="openChat">
          {{ runtime === 'desktop' ? '窗口内打开 BOSS' : '如何连接' }}
        </button>
      </div>
    </div>
    <div v-if="error" role="alert" class="error-banner">
      {{ error }} <button class="text-button" :disabled="loading" @click="load()">重新读取</button>
    </div>
    <p v-if="notice" role="status" class="notice-banner">{{ notice }}</p>
    <details v-if="connection && view !== 'replies' && view !== 'overview'" class="data-connection">
      <summary>
        <span
          :class="['status-dot', { connected: sourceConnected }]"
        />本机求职资料与同步记录<small>{{ liveStatus.sourceLabel }}</small>
      </summary>
      <div class="data-source-counts">
        <span
          >本地开聊 <b>{{ connection.historyCount }}</b></span
        ><span
          >已同步会话 <b>{{ connection.syncedCount }}</b></span
        ><span
          >个人跟进 <b>{{ connection.manualCount }}</b></span
        ><span
          >账户 <b>{{ connection.account || '等待登录' }}</b></span
        >
      </div>
      <p>
        {{
          sourceConnected
            ? '后台正在按当前账号读取可加载的联系人、消息和岗位。具体范围与缺项见同步结果。'
            : '请在职途 Atlas 桌面程序打开 BOSS 消息页并保持登录；此大屏每 15 秒读取同步结果。'
        }}
      </p>
      <p v-if="connection.syncAt">
        最近采集：{{ new Date(connection.syncAt).toLocaleString('zh-CN') }} ·
        同步会话默认记为已沟通，投递和面试状态由你确认。
      </p>
      <p v-if="!connection.database">旧版历史档案暂不可读；已保存资料与新同步内容仍可查看。</p>
    </details>
    <details v-if="view === 'overview'" class="communication-diagnostics"><summary>同步详情 · {{ syncCoverage?.conversations || 0 }} 个会话 · {{ syncCoverage?.messages || 0 }} 条消息</summary><BossSyncCoverage :coverage="syncCoverage" @changed="refreshSync" /></details>
    <BossSyncCoverage v-else-if="view !== 'replies'" :coverage="syncCoverage" @changed="refreshSync" />
    <template v-if="view === 'replies'">
      <div class="communication-status">
        <span
          ><i :class="['status-dot', { connected: sourceConnected }]" />消息同步：{{
            liveStatus.sourceLabel
          }}</span
        ><span>回复助手：{{ liveStatus.replyLabel }}</span
        ><button class="text-button" @click="openChat">
          {{ runtime === 'desktop' ? '打开 BOSS 消息页 ↗' : '连接说明' }}
        </button>
      </div>
      <details class="communication-diagnostics">
        <summary>
          同步范围与诊断 · {{ syncCoverage?.conversations || 0 }} 个会话 /
          {{ syncCoverage?.messages || 0 }} 条消息 · 完整历史未验证
        </summary>
        <BossSyncCoverage :coverage="syncCoverage" @changed="refreshSync" />
        <p>
          消息读取与回复发送分别运行。已同步的聊天记录可以查看，回复助手仍需有效的桌面消息页连接。
        </p>
      </details>
      <nav class="communication-tabs" aria-label="沟通中心功能">
        <button
          v-for="tab in communicationTabs"
          :key="tab.id"
          :aria-current="communicationTab === tab.id ? 'page' : undefined"
          :class="{ active: communicationTab === tab.id }"
          @click="communicationTab = tab.id"
        >
          {{ tab.label
          }}<span v-if="tab.id === 'review' && pending.length">{{ pending.length }}</span
          ><span v-if="tab.id === 'settings' && settingsDirty">未保存</span>
        </button>
      </nav>
    </template>
    <BossSyncResults
      v-if="view === 'sync'"
      ref="syncResults"
      @opportunity="openSyncedOpportunity"
      @conversation="openSyncedConversation"
      @coverage="syncCoverage = $event"
    />
    <BossInbox
      v-if="view === 'replies'"
      v-show="communicationTab === 'inbox'"
      :pending-by-conversation="pendingByConversation"
      :active="communicationTab === 'inbox'"
      @review="showConversationReview"
      @boss="openChat"
      @all="view = 'replies'"
      @opportunity="openSyncedOpportunity"
      @coverage="syncCoverage = $event"
    />

    <template v-if="['overview', 'companies'].includes(view)">
      <div class="filterbar">
        <div class="search-field">
          <span>⌕</span
          ><input
            v-model="search"
            aria-label="搜索企业或岗位"
            placeholder="搜索企业、岗位、地址…"
          />
        </div>
        <select v-model="stage" aria-label="筛选投递状态">
          <option value="">全部状态</option>
          <option v-for="s in pipelineStages" :key="s">{{ s }}</option></select
        ><select v-model="city" aria-label="筛选城市"><option value="">全部城市</option><option v-for="c in cityOptions" :key="c">{{ c }}</option></select><select v-model="district" aria-label="筛选行政区">
          <option value="">全部区县</option>
          <option v-for="d in districtOptions" :key="d">
            {{ d }}
          </option></select
        ><select v-model="period" aria-label="筛选时间">
          <option value="0">全部时间</option>
          <option value="7">近 7 天</option>
          <option value="30">近 30 天</option></select
        ><button
          v-if="search || stage || city || district || period !== '0'"
          class="text-button"
          @click="clearFilters()"
        >
          清除筛选</button
        ><span class="filter-count">{{ filtered.length }} 个机会 · 当前筛选</span>
      </div>
      <section class="kpi-grid">
        <article class="kpi">
          <span class="kpi-label">跟进企业</span>
          <div class="kpi-value">{{ stats.companies }}<small>家</small></div>
          <p>{{ stats.total }} 个岗位机会</p>
        </article>
        <article class="kpi">
          <span class="kpi-label">面试进行中</span>
          <div class="kpi-value amber">{{ stats.interviews }}<small>个</small></div>
          <p>{{ stats.offers }} 个 Offer</p>
        </article>
        <article class="kpi">
          <span class="kpi-label">已确认经历依据</span>
          <div class="kpi-value mint">
            {{ state.profile.evidence.filter((e) => e.confirmed).length }}<small>项</small>
          </div>
          <p>共 {{ state.profile.evidence.length }} 项经历</p>
        </article>
        <article class="kpi">
          <span class="kpi-label">岗位月薪中位数</span>
          <div class="kpi-value">
            {{ stats.salaryMedian == null ? '—' : stats.salaryMedian.toFixed(1)
            }}<small v-if="stats.salaryMedian != null">K</small>
          </div>
          <p>{{ stats.salarySamples }} 个完整薪资样本 <span>按薪资区间中点统计</span></p>
        </article>
      </section>
    </template>
    <template v-if="view === 'overview'">
      <div class="overview-analysis-link"><RouterLink to="/main-layout/CareerInsights">简历竞争力与市场机会 <span>全局分析 →</span></RouterLink></div>
      <div class="hero-grid">
        <section class="panel map-panel">
          <div class="panel-heading">
            <div>
              <h2>机会分布</h2>
            </div>
            <span class="subtle-tag">{{ city || '全国' }} · {{ filtered.length }} 个机会</span>
          </div>
          <OpportunityMap
            :items="mapItems"
            :city="city"
            :default-city="defaultMapCity(state.profile.preferredCities)"
            @city="city = $event"
            :selected-district="district"
            @district="(v) => (district = district === v ? '' : v)"
            @select="editOpportunity"
          />
          <div class="map-legend">
            <button
              v-for="s in stats.stages"
              :key="s.name"
              :class="{ selected: stage === s.name }"
              @click="stage = stage === s.name ? '' : s.name"
            >
              <i :style="{ background: s.color }" />{{ s.name }} <b>{{ s.count }}</b>
            </button>
          </div>
          <div v-if="!all.length" class="map-empty">
            <strong>暂无跟进机会</strong>
            <p>导入本地开聊记录，或添加正在关注的公司。</p>
            <button class="text-button" @click="openWorkspace('match')">添加第一个机会 ↗</button>
          </div>
          <div v-if="stats.unlocated" class="map-warning">
            {{ stats.unlocated }} 个机会待补充地址，可在企业详情中完善。
          </div>
        </section>
        <aside class="right-stack">
          <BossInbox
            compact
            @all="view = 'replies'"
            @opportunity="openSyncedOpportunity"
            @coverage="syncCoverage = $event"
          />
          <section class="panel next-panel">
            <div class="panel-heading">
              <div>
                <h2>待办</h2>
              </div>
              <span class="number-badge">{{ stats.due.length + pending.length }}</span>
            </div>
            <button v-if="pending.length" class="action-row" @click="view = 'replies'">
              <span class="action-symbol violet">↗</span>
              <div>
                <b>{{ pending.length }} 条消息等你确认</b><small>薪资、面试与其他重要事项</small>
              </div>
              <span>→</span></button
            ><button
              v-for="o in stats.due.slice(0, 3)"
              :key="o.id"
              class="action-row"
              @click="editOpportunity(o)"
            >
              <span class="action-symbol amber">◷</span>
              <div>
                <b>{{ o.job.companyName }}</b
                ><small>{{ o.nextDate }} · {{ o.job.jobName }}</small>
              </div>
              <span>→</span>
            </button>
            <div v-if="!stats.due.length && !pending.length" class="quiet-state">
              <span class="quiet-ring">✓</span><b>暂无到期待办</b>
              <p>设置下次跟进日期，重要机会不会遗漏。</p>
            </div>
          </section>
          <section class="panel pipeline-panel">
            <div class="panel-heading">
              <div>
                <h2>求职阶段</h2>
              </div>
            </div>
            <div class="pipeline-bars">
              <button
                v-for="s in stats.stages"
                :key="s.name"
                @click="stage = stage === s.name ? '' : s.name"
              >
                <span><i :style="{ background: s.color }" />{{ s.name }}</span>
                <div class="bar-track">
                  <div
                    :style="{
                      width: stats.total ? (s.count / stats.total) * 100 + '%' : '0%',
                      background: s.color
                    }"
                  />
                </div>
                <b>{{ s.count }}</b>
              </button>
            </div>
            <p class="panel-caption">当前阶段分布 · 开聊记录不等于已投递</p>
          </section>
        </aside>
      </div>
      <ExecutionSummary />
      <CoordinatorPanel />
      <DiscoveryRecommendations />
      <ContactPanel compact />
      <section
        v-if="
          view === 'overview' &&
          loadedAt &&
          (!all.length || !sourceConnected || readiness.some((i) => !i.ready))
        "
        class="setup-guide"
      >
        <div class="setup-title">
          <div>
            <h2>{{ all.length ? '让工作台准备就绪' : '从一个真实机会开始' }}</h2>
          </div>
          <button class="text-button" @click="router.push('/main-layout/CareerSettings')">
            设置与连接 ↗
          </button>
        </div>
        <div class="setup-steps">
          <button @click="openWorkspace('profile')">
            <i>{{ readiness.every((i) => i.ready) ? '✓' : '01' }}</i
            ><span
              ><b>确认求职资料</b
              ><small
                >{{ readiness.filter((i) => i.ready).length }}/{{
                  readiness.length
                }}
                项已准备</small
              ></span
            ><em>↗</em></button
          ><button @click="openChat">
            <i>{{ sourceConnected ? '✓' : '02' }}</i
            ><span
              ><b>连接 BOSS 消息页</b
              ><small>{{
                sourceConnected ? '已加载会话持续同步' : '在桌面程序登录并进入消息页'
              }}</small></span
            ><em>↗</em></button
          ><button @click="openWorkspace('match')">
            <i>{{ all.length ? '✓' : '03' }}</i
            ><span><b>评估并加入机会</b><small>粘贴 JD，也可以直接手动记录</small></span
            ><em>↗</em>
          </button>
        </div>
      </section>
      <div class="analysis-grid">
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h2>最近 7 天，新机会</h2>
            </div>
            <strong class="small-metric">{{ stats.trend.reduce((s, d) => s + d.count, 0) }}</strong>
          </div>
          <div class="trend-chart">
            <div v-for="t in stats.trend" :key="t.day">
              <b>{{ t.count }}</b>
              <div class="trend-track">
                <i
                  :style="{
                    height:
                      (t.count
                        ? Math.max(
                            5,
                            (t.count / Math.max(1, ...stats.trend.map((d) => d.count))) * 80
                          )
                        : 2) + 'px',
                    opacity: t.count ? 1 : 0.2
                  }"
                />
              </div>
              <small>{{ t.day.slice(5).replace('-', '/') }}</small>
            </div>
          </div>
          <p class="panel-caption">按首次开聊／手动创建日期去重，缺失日期不计入</p>
        </section>
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h2>薪资机会分布</h2>
            </div>
            <span class="subtle-tag">月薪 · K</span>
          </div>
          <p v-if="!stats.salarySamples" class="panel-caption">暂无可统计的薪资样本</p>
          <div v-else class="distribution">
            <div v-for="b in stats.salaryBands" :key="b.name">
              <span>{{ b.name }}</span>
              <div class="bar-track">
                <i
                  :style="{
                    width: (stats.salarySamples ? (b.count / stats.salarySamples) * 100 : 0) + '%'
                  }"
                />
              </div>
              <b>{{ b.count }}</b>
            </div>
          </div>
          <p class="panel-caption">按薪资区间中点统计，分组随样本调整 · {{ stats.total - stats.salarySamples }} 个薪资未知</p>
        </section>
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h2>你的机会集中在哪</h2>
            </div>
          </div>
          <div v-if="stats.districts.length" class="district-ranking">
            <button
              v-for="(d, i) in stats.districts.slice(0, 4)"
              :key="d.name"
              @click="district = d.name"
            >
              <span class="rank">0{{ i + 1 }}</span
              ><b>{{ d.name }}</b
              ><span class="rank-meter"
                ><i
                  :style="{
                    width: (d.count / Math.max(1, stats.districts[0].count)) * 100 + '%'
                  }" /></span
              ><strong>{{ d.count }}</strong>
            </button>
          </div>
          <p v-else class="empty-inline">补充企业地址后，显示区域分布。</p>
          <p class="panel-caption">点击区域，联动地图与机会列表</p>
        </section>
      </div>
      <section class="panel opportunities-panel">
        <div class="panel-heading">
          <div>
            <h2>值得进一步了解的机会</h2>
          </div>
          <button class="text-button" @click="view = 'companies'">查看全部 ↗</button>
        </div>
        <OpportunityTable :items="ranked.slice(0, 5)" @select="editOpportunity" />
        <div v-if="!filtered.length" class="empty-inline">
          暂无匹配的机会。添加岗位或调整筛选条件。
        </div>
      </section>
    </template>
    <section v-if="view === 'companies'" class="panel opportunities-panel">
      <div class="panel-heading">
        <div>
          <h2>企业与求职进展</h2>
        </div>
        <button class="primary-button" @click="openWorkspace('match')">＋ 添加 / 评估岗位</button>
      </div>
      <div class="opportunity-context">
        <span
          >这里是已跟进和历史会话关联的机会。阶段不代表本轮自动投递结果，旧岗位保留原始薪资。</span
        ><RouterLink to="/main-layout/CareerDiscovery?contact=1">自动投递与本轮结果 →</RouterLink>
      </div>
      <div class="list-toolbar">
        <span>{{ ranked.length }} 个机会</span
        ><label><input type="checkbox" v-model="includeArchived" /> 包含已归档</label
        ><label
          >排序<select v-model="sortBy" aria-label="机会排序">
            <option value="match">匹配优先</option>
            <option value="recent">最近新增</option>
            <option value="followup">最早跟进</option>
          </select></label
        >
      </div>
      <EnterpriseBoard :items="ranked" :city="city" :default-city="defaultMapCity(state.profile.preferredCities)" @city="city = $event" @select="editOpportunity"
        ><OpportunityTable :items="visibleOpportunities" @select="editOpportunity" />
        <div v-if="ranked.length > pageSize" class="atlas-pagination">
          <span>第 {{ currentPage }} / {{ pageCount }} 页 · 每页 {{ pageSize }} 条</span
          ><button :disabled="currentPage <= 1" @click="opportunityPage = currentPage - 1">
            上一页</button
          ><button :disabled="currentPage >= pageCount" @click="opportunityPage = currentPage + 1">
            下一页
          </button>
        </div>
      </EnterpriseBoard>
      <div v-if="!ranked.length" class="empty-inline">
        <p>
          {{
            all.length ? '没有符合当前筛选的机会。' : '还没有跟进机会，先录入一个岗位或连接 BOSS。'
          }}
        </p>
        <button v-if="all.length" class="text-button" @click="clearFilters">清空筛选</button
        ><button v-else class="text-button" @click="openWorkspace('match')">
          添加第一个机会 ↗
        </button>
      </div>
      <div class="company-analysis">
        <span>行业分布</span
        ><b v-for="i in stats.industry.slice(0, 8)" :key="i.name"
          >{{ i.name }} <em>{{ i.count }}</em></b
        >
      </div>
    </section>
    <template v-if="view === 'replies'"
      ><div class="reply-layout">
        <section v-show="communicationTab === 'settings'" class="panel reply-policy">
          <div class="panel-heading">
            <div>
              <h2>自动回复设置</h2>
            </div>
          </div>
          <p class="section-description">
            常规问候、已确认的项目经历和求职城市可自动回复。薪资、面试、简历和无法判断的咨询进入待确认队列。
          </p>
          <label
            >运行方式<select v-model="replySettings.mode">
              <option value="auto">常规咨询自动回复</option>
              <option value="review">全部先确认</option>
              <option value="off">暂停回复助手</option>
            </select></label
          >
          <div class="form-two">
            <label
              >每日自动回复上限<input
                v-model.number="replySettings.dailyLimit"
                type="number"
                min="1"
                max="100" /></label
            ><label
              >同一会话间隔（分钟）<input
                v-model.number="replySettings.cooldownMinutes"
                type="number"
                min="1"
                max="1440" /></label
            ><label
              >开始时段（北京时间）<input
                v-model.number="replySettings.startHour"
                type="number"
                min="0"
                max="23" /></label
            ><label
              >结束时段<input v-model.number="replySettings.endHour" type="number" min="1" max="24"
            /></label>
          </div>
          <p v-if="policyError" class="error-banner" role="alert">{{ policyError }}</p>
          <p v-if="settingsDirty" class="policy-unsaved">
            有未保存的策略修改，当前仍按已保存的策略运行。
          </p>
          <div class="policy-actions">
            <button
              class="primary-button"
              :disabled="savingPolicy || !savedSettings || !settingsDirty"
              @click="saveReplySettings"
            >
              {{ savingPolicy ? '保存中…' : '保存回复策略' }}</button
            ><button
              v-if="settingsDirty"
              class="text-button"
              :disabled="savingPolicy"
              @click="reloadPolicy"
            >
              读取已保存策略</button
            ><button
              v-if="policySnapshot.mode !== 'off'"
              class="text-button"
              :disabled="savingPolicy"
              @click="pauseReplies"
            >
              暂停回复助手
            </button>
          </div>
          <div class="connection-card">
            <span :class="['status-dot', { connected }]" />
            <div>
              <b>{{ liveStatus.replyLabel }}</b>
              <p>
                在本程序的 BOSS
                浏览器保持消息页打开，监测已加载的会话；不会刷新页面。有未发送草稿时暂停。
              </p>
              <button class="text-button" @click="openChat">
                {{ runtime === 'desktop' ? '打开消息页 ↗' : '如何连接' }}
              </button>
            </div>
          </div>
        </section>
        <section v-show="communicationTab === 'review'" class="panel reply-queue">
          <div class="panel-heading">
            <div>
              <h2>待确认与发送记录</h2>
            </div>
            <span class="subtle-tag">{{ pending.length }} 待确认</span>
          </div>
          <p class="section-description">
            这里处理助手准备的回复及发送结果。阅读完整对话请切回「会话沟通」；确认发送前会再次核对具体内容。
          </p>
          <p v-if="replyBoss" class="conversation-scope">
            正在查看所选联系人的记录
            <button class="text-button" @click="clearConversationReview">查看全部联系人</button>
          </p>
          <div class="queue-tabs" role="group" aria-label="回复记录分类">
            <button
              v-for="f in replyFilters"
              :key="f.value"
              :class="{ active: replyFilter === f.value }"
              @click="replyFilter = f.value"
            >
              {{ f.label }} <span>{{ queue.counts[f.value] }}</span>
            </button>
          </div>
          <input
            v-model="replySearch"
            class="queue-search"
            aria-label="搜索回复记录"
            placeholder="搜索企业、联系人、消息内容"
          />
          <p v-if="replyTotal > replies.length" class="field-hint">
            保留全部待处理项，并展示最近 200 条已完成记录。
          </p>
          <div v-if="!queue.items.length" class="quiet-state">
            <span class="quiet-ring">✓</span
            ><b>{{
              replySearch
                ? '没有匹配的回复记录'
                : replyFilter === 'attention'
                  ? '当前没有需要你处理的消息'
                  : '这个分类还没有记录'
            }}</b>
            <p>
              {{
                connected
                  ? '收到新消息后，助手会在这里记录。'
                  : '连接桌面程序的 BOSS 消息页后，这里显示沟通记录。'
              }}
            </p>
            <button v-if="replySearch" class="text-button" @click="replySearch = ''">
              清空搜索
            </button>
          </div>
          <article v-for="r in visibleReplies" :key="r.id" class="reply-item">
            <div class="reply-meta">
              <b>{{ r.company || r.person || '招聘方' }}</b
              ><span>{{ r.category }}</span
              ><small>{{ replyStatusLabel(r) }}</small>
            </div>
            <div class="reply-time">{{ r.person || '招聘方' }} · {{ formatTime(r.createdAt) }}</div>
            <div class="reply-section-label">对方消息</div>
            <blockquote>{{ r.incoming }}</blockquote>
            <p class="reply-reason"><b>处理原因：</b>{{ r.reason }}</p>
            <div class="reply-section-label">
              {{ r.status === 'sent' ? '已发送内容' : '回复内容' }}
            </div>
            <textarea
              v-if="['review', 'blocked'].includes(r.status) && !commands[r.id]"
              maxlength="1500"
              v-model="replyDrafts[r.id]"
              rows="3"
              placeholder="请输入确认后要发送的内容"
              :aria-label="`回复 ${r.company || r.person}`"
            />
            <p v-else-if="commands[r.id] || r.draft" class="sent-draft">
              {{ commands[r.id]?.text || r.draft }}
            </p>
            <small
              v-if="['review', 'blocked'].includes(r.status) && !commands[r.id]"
              class="draft-count"
              >草稿暂存当前窗口 · {{ replyDrafts[r.id]?.length || 0 }} / 1500</small
            >
            <p v-if="commands[r.id]" class="queue-note">
              已确认排队。{{
                policySnapshot.mode === 'off'
                  ? '助手已暂停，恢复后才会处理。'
                  : connected
                    ? '等待核对最新会话后发送。'
                    : '等待桌面消息页连接后处理。'
              }}
            </p>
            <p v-if="r.status === 'uncertain'" class="queue-note">
              请先到 BOSS 核实发送结果，此消息不会自动重试。<button
                class="text-button"
                @click="openChat"
              >
                前往核实 ↗
              </button>
            </p>
            <div v-if="['uncertain', 'sending'].includes(r.status)" class="reply-buttons">
              <button class="text-button" @click="resolveReply(r, 'sent')">确认已发送</button
              ><button class="text-button" @click="resolveReply(r, 'not-sent')">确认未发送</button
              ><button class="text-button" @click="resolveReply(r, 'unknown')">仍不确定</button>
            </div>
            <div class="reply-context-link">
              <button class="text-button" @click="openSyncedConversation(r.bossId)">
                查看完整会话 →
              </button>
            </div>
            <div v-if="['review', 'blocked'].includes(r.status)" class="reply-buttons">
              <button
                class="primary-button"
                :disabled="!replyDrafts[r.id]?.trim() || !!commands[r.id] || commandBusy[r.id]"
                @click="replyCommand(r, 'approve')"
              >
                {{
                  commandBusy[r.id]
                    ? '处理中…'
                    : commands[r.id]
                      ? '已确认排队'
                      : connected && policySnapshot.mode !== 'off'
                        ? '确认发送'
                        : '确认并排队'
                }}</button
              ><button
                class="text-button"
                :disabled="commandBusy[r.id]"
                @click="replyCommand(r, 'dismiss')"
              >
                {{ commands[r.id] ? '取消此条回复' : '忽略此条' }}
              </button>
            </div>
          </article>
          <div v-if="queue.items.length > pageSize" class="atlas-pagination">
            <span>第 {{ currentReplyPage }} / {{ replyPageCount }} 页</span
            ><button :disabled="currentReplyPage <= 1" @click="replyPage = currentReplyPage - 1">
              上一页</button
            ><button
              :disabled="currentReplyPage >= replyPageCount"
              @click="replyPage = currentReplyPage + 1"
            >
              下一页
            </button>
          </div>
        </section>
      </div></template
    >
    <footer v-if="view !== 'replies'" class="dash-footer">
      <span>ATLAS <i>CAREER WORKSPACE</i></span
      ><span
        >{{ loadedAt ? '本地数据同步于 ' + loadedAt : '正在读取本地数据' }} ·
        {{ records.warning || '个人跟进 + BOSS 本地记录' }}</span
      ><button @click="openWorkspace('profile')">个人资料与简历 ↗</button>
    </footer>
    <ElDialog
      :model-value="!!editing"
      :title="editing ? editing.job.companyName + ' · 跟进详情' : '跟进详情'"
      :before-close="beforeCloseOpportunity"
      :close-on-click-modal="false"
      :close-on-press-escape="!saving"
      :show-close="false"
      :append-to-body="false"
      width="min(1000px, calc(100vw - 32px))"
      align-center
      class="atlas-opportunity-modal"
      ><template v-if="editing">
        <section class="opportunity-dialog">
          <div class="dialog-header">
            <div>
              <h2 id="opportunity-title">{{ editing.job.companyName }}</h2>
              <p>{{ editing.job.jobName }} · {{ editing.stage }} · {{ editing.district }}</p>
            </div>
            <button
              class="icon-button"
              aria-label="关闭企业详情"
              :disabled="saving"
              @click="closeOpportunity"
            >
              ×
            </button>
          </div>
          <nav class="detail-navigation" aria-label="机会详情分区">
            <button
              v-for="tab in detailTabs"
              :key="tab.key"
              :aria-pressed="detailTab === tab.key"
              @click="selectDetailTab(tab.key)"
            >
              {{ tab.label }}
            </button>
          </nav>
          <div ref="detailScroll" class="dialog-scroll">
            <div class="detail-meta">
              <span>{{ editing.source }}</span
              ><span>{{ editing.industry || '行业待补充' }}</span
              ><span>{{ editing.scale || '规模待补充' }}</span>
            </div>
            <OpportunityIntelligence
              ref="intelligenceEditor"
              :key="editing.id"
              v-show="detailTab !== 'progress'"
              :section="detailTab"
              :assessment="editingAssessment"
              :id="editing.id"
              :job="editing.job"
              :account-id="editing.userId"
              :profile-version="profileVersion"
              :evidence="state.profile.evidence"
            />
            <section v-show="detailTab === 'progress'" class="progress-panel">
              <h3>进展与下一步</h3>
              <div class="form-two">
                <label
                  >投递状态<select v-model="editForm.stage">
                    <option v-for="s in pipelineStages" :key="s">{{ s }}</option>
                  </select></label
                ><label>下次跟进<input type="date" v-model="editForm.nextDate" /></label>
              </div>
              <label v-if="editForm.stage === '已结束'"
                >结束原因<input
                  v-model="editForm.endReason"
                  placeholder="例如：岗位关闭、本人放弃、薪资不符、未通过面试"
                  maxlength="1000"
              /></label>
              <label
                >办公地址<input v-model="editForm.address" placeholder="城市、区县、道路与门牌"
              /></label>
              <div class="form-two">
                <label
                  >经度（可选）<input
                    v-model="editForm.lng"
                    type="number"
                    step="any"
                    placeholder="121.x" /></label
                ><label
                  >纬度（可选）<input
                    v-model="editForm.lat"
                    type="number"
                    step="any"
                    placeholder="31.x"
                /></label>
              </div>
              <div class="form-two">
                <label
                  >坐标系<select v-model="editForm.crs">
                    <option value="unknown">尚未确认</option>
                    <option value="wgs84">WGS84（OpenStreetMap）</option>
                    <option value="gcj02">GCJ02（国内地图）</option>
                  </select></label
                ><label
                  >手动记录通勤分钟<input
                    v-model="editForm.commuteMinutes"
                    type="number"
                    min="0"
                    max="600"
                    placeholder="未知可留空"
                /></label>
              </div>
              <p class="field-hint">
                只有已确认 WGS84 坐标显示在街道底图；未知坐标按区域展示，通勤时间由本人填写。
              </p>
              <label
                >跟进笔记<textarea
                  v-model="editForm.note"
                  rows="3"
                  placeholder="团队、职责、面试反馈、下一步…"
                />
              </label>
              <OpportunityProgress ref="progressEditor" :id="editing.id" @changed="load(true)" />
            </section>
          </div>
          <div class="dialog-footer">
            <span :role="editError ? 'alert' : 'status'" :class="{ 'save-error': editError }">{{
              editError || (opportunityDirty ? '有未保存的进展' : '已与本机记录一致')
            }}</span
            ><button
              class="primary-button"
              :disabled="saving || !opportunityDirty"
              @click="saveOpportunity"
            >
              {{ saving ? '保存中…' : '保存进展' }}
            </button>
          </div>
        </section>
      </template></ElDialog
    >
  </main>
</template>
<script setup lang="ts">
import SetupGuide from '../../components/career/SetupGuide.vue'
import ContactPanel from '../../components/career/ContactPanel.vue'
import {
  computed,
  ref,
  onMounted,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  defineComponent,
  h,
  inject,
  watch
} from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElDialog, ElMessageBox } from 'element-plus'
import { useDraftProtection } from '../../composables/useDraftProtection'
import { connectionSummary, profileReadiness, replyQueue } from '../../../../common/career-ux'
import DiscoveryRecommendations from '../../components/career/DiscoveryRecommendations.vue'
import ExecutionSummary from '../../components/career/ExecutionSummary.vue'
import CoordinatorPanel from '../../components/career/CoordinatorPanel.vue'
import OpportunityProgress from '../../components/career/OpportunityProgress.vue'
import BossInbox from '../../components/career/BossInbox.vue'
import BossSyncResults from '../../components/career/BossSyncResults.vue'
import BossSyncCoverage from '../../components/career/BossSyncCoverage.vue'
import OpportunityIntelligence from '../../components/career/OpportunityIntelligence.vue'
import EnterpriseBoard from '../../components/career/EnterpriseBoard.vue'
import { defaultMapCity } from '../../../../common/opportunity-map'
import OpportunityMap from '../../components/career/OpportunityMap.vue'
import { jobLocation } from '../../../../common/regions'
import { emptyCareerState, assessCareerJob } from '../../../../common/career'
import {
  buildOpportunities,
  summarizeDashboard,
  stageColors,
  pipelineStages,
  localDay,
  type DashboardOpportunity,
  type DashboardPreferences
} from '../../../../common/dashboard'
import {
  defaultReplySettings,
  validateReplySettings,
  type ReplyEvent
} from '../../../../common/auto-reply'
const router = useRouter(),
  screen = ref<HTMLElement>(),
  state = ref(emptyCareerState()),
  preferences = ref<DashboardPreferences>({ version: 1, overrides: {} })
const records = ref<any>({ applications: [] }),
  model = ref<{ name: string; officialDeepSeek: boolean; provider?: string } | null>(null),
  connection = ref<any>(null),
  loading = ref(false),
  saving = ref(false),
  error = ref(''),
  notice = ref(''),
  loadedAt = ref('')
const runtime = inject<'desktop' | 'web'>('atlas-runtime', 'desktop')
const route = useRoute()
const view = computed({
  get: () =>
    ['companies', 'replies', 'sync'].includes(String(route.query.view))
      ? String(route.query.view)
      : 'overview',
  set: (value) => {
    router.replace({
      path: '/main-layout/CareerDashboard',
      query: { ...route.query, view: value === 'overview' ? undefined : value }
    })
  }
})
const communicationTabs = [
  { id: 'inbox', label: '会话沟通' },
  { id: 'review', label: '待确认与发送记录' },
  { id: 'settings', label: '自动回复设置' }
]
const communicationTab = computed({
  get: () =>
    ['review', 'settings'].includes(String(route.query.communication))
      ? String(route.query.communication)
      : 'inbox',
  set: (value) => {
    void router.replace({
      query: { ...route.query, communication: value === 'inbox' ? undefined : value }
    })
  }
})
const replyBoss = computed(() =>
  typeof route.query.replyBoss === 'string' ? route.query.replyBoss : ''
)
function showConversationReview(id: string) {
  replyFilter.value = 'attention'
  replySearch.value = ''
  void router.replace({ query: { ...route.query, communication: 'review', replyBoss: id } })
}
function clearConversationReview() {
  void router.replace({ query: { ...route.query, replyBoss: undefined } })
}
const pendingByConversation = computed(() => {
  const counts: Record<string, number> = {}
  for (const r of pending.value) {
    const key = JSON.stringify([r.userId, r.bossId])
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
})
const revision = ref(''),
  editingRevision = ref(''),
  editBaseline = ref('')
const savedSettings = ref(''),
  settingsRevision = ref(''),
  policySnapshot = ref(defaultReplySettings()),
  policyError = ref(''),
  savingPolicy = ref(false)
const settingsDirty = computed(
  () => !!savedSettings.value && JSON.stringify(replySettings.value) !== savedSettings.value
)
const commandBusy = ref<Record<string, boolean>>({}),
  replyTotal = ref(0)
const pageSize = 20,
  opportunityPage = ref(1),
  replyPage = ref(1),
  sortBy = ref('match'),
  replyFilter = ref('attention'),
  replySearch = ref('')
const replyFilters: { value: 'attention' | 'queued' | 'history' | 'all'; label: string }[] = [
  { value: 'attention', label: '待处理' },
  { value: 'queued', label: '待发送' },
  { value: 'history', label: '已完成' },
  { value: 'all', label: '全部' }
]
const search = ref(''),
  stage = ref(''),
  city = ref(''),
  district = ref(''),
  period = ref('0'),
  replySettings = ref(defaultReplySettings()),
  replies = ref<ReplyEvent[]>([]),
  heartbeat = ref<any>({}),
  replyDrafts = ref<Record<string, string>>({}),
  commands = ref<Record<string, { action: string; text: string; at: string }>>({}),
  now = ref(Date.now())
const liveStatus = computed(() =>
  connectionSummary(
    { ...connection.value, automatic: syncCoverage.value?.automatic },
    heartbeat.value,
    policySnapshot.value,
    now.value
  )
)
const connected = computed(() => liveStatus.value.live)
const sourceConnected = computed(() => liveStatus.value.collecting)
const readiness = computed(() => profileReadiness(state.value.profile))
const queue = computed(() =>
  replyQueue(
    replyBoss.value ? replies.value.filter((r) => r.bossId === replyBoss.value) : replies.value,
    commands.value,
    replyFilter.value,
    replySearch.value
  )
)
const replyPageCount = computed(() => Math.max(1, Math.ceil(queue.value.items.length / pageSize)))
const currentReplyPage = computed(() => Math.min(replyPage.value, replyPageCount.value))
const visibleReplies = computed(() =>
  queue.value.items.slice(
    (currentReplyPage.value - 1) * pageSize,
    currentReplyPage.value * pageSize
  )
)
const accountLabel = computed(() => records.value.accountName || '本地工作台')
const dayLabel = computed(() =>
  new Date(now.value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  })
)
const contactOutcomes = ref<Record<string, string>>({})
const includeArchived = ref(false),
  opportunityStates = ref<Record<string, { archived: boolean; mergedInto: string }>>({})
const all = computed(() =>
  buildOpportunities(state.value, records.value.applications || [], preferences.value)
    .filter(
      (o) =>
        !opportunityStates.value[o.id]?.mergedInto &&
        (includeArchived.value || !opportunityStates.value[o.id]?.archived)
    )
    .map((o) => ({
      ...o,
      source:
        contactOutcomes.value[o.id] === 'completed'
          ? '自动联系 · 平台核验'
          : contactOutcomes.value[o.id] === 'manual'
            ? '本人确认已发送'
            : o.source
    }))
)
const cityOptions = computed(() => [...new Set([city.value, ...all.value.map(o=>jobLocation(o.job).city || '地点待核实')])].filter(Boolean).sort())
const districtOptions = computed(() => [...new Set(all.value.filter(o=>!city.value || (jobLocation(o.job).city||'地点待核实')===city.value).map(o=>o.district))].sort())
const mapItems = computed(() => all.value.filter(o => (!search.value || `${o.job.companyName} ${o.job.jobName} ${o.job.address || ''}`.toLowerCase().includes(search.value.trim().toLowerCase())) && (!stage.value || o.stage === stage.value) && (period.value === '0' || (o.createdAt && now.value - Date.parse(o.createdAt) <= Number(period.value) * 86400000))))
const filtered = computed(() =>
  all.value.filter(
    (o) =>
      (!search.value ||
        `${o.job.companyName} ${o.job.jobName} ${o.job.address || ''}`
          .toLowerCase()
          .includes(search.value.trim().toLowerCase())) &&
      (!stage.value || o.stage === stage.value) &&
      (!city.value || (jobLocation(o.job).city || '地点待核实') === city.value) &&
      (!district.value || o.district === district.value) &&
      (period.value === '0' ||
        (o.createdAt && now.value - Date.parse(o.createdAt) <= Number(period.value) * 86400000))
  )
)
const stats = computed(() => summarizeDashboard(filtered.value, localDay(now.value))),
  ranked = computed(() =>
    [...filtered.value].sort((a, b) =>
      sortBy.value === 'recent'
        ? (b.createdAt || '').localeCompare(a.createdAt || '')
        : sortBy.value === 'followup'
          ? (a.nextDate || '9999').localeCompare(b.nextDate || '9999')
          : b.score - a.score
    )
  )
const pageCount = computed(() => Math.max(1, Math.ceil(ranked.value.length / pageSize)))
const currentPage = computed(() => Math.min(opportunityPage.value, pageCount.value))
const visibleOpportunities = computed(() =>
  ranked.value.slice((currentPage.value - 1) * pageSize, currentPage.value * pageSize)
)
const pending = computed(() =>
  replies.value.filter(
    (r) => ['review', 'blocked', 'uncertain'].includes(r.status) && !commands.value[r.id]
  )
)
const detailTabs = [
  { key: 'job', label: '岗位详情' },
  { key: 'analysis', label: 'AI 分析' },
  { key: 'greeting', label: '匹配招呼' },
  { key: 'history', label: '历史快照' },
  { key: 'progress', label: '跟进记录' }
]
const detailTab = ref('job'),
  detailScroll = ref<HTMLElement>()
function selectDetailTab(key: string) {
  detailTab.value = key
  if (detailScroll.value) detailScroll.value.scrollTop = 0
}
const editing = ref<DashboardOpportunity | null>(null),
  editForm = ref<any>({}),
  editError = ref('')
const progressEditor = ref<{ hasDraft: boolean; save: () => Promise<boolean> } | null>(null)
const intelligenceEditor = ref<{ hasDraft: boolean; save: () => Promise<boolean> } | null>(null)
const syncCoverage = ref<any>(null),
  profileVersion = ref('')
const opportunityDirty = computed(
  () =>
    !!editing.value &&
    (JSON.stringify(editForm.value) !== editBaseline.value ||
      !!progressEditor.value?.hasDraft ||
      !!intelligenceEditor.value?.hasDraft)
)
const editingAssessment = computed(() =>
  editing.value ? assessCareerJob(editing.value.job, state.value.profile) : null
)
const OpportunityTable = defineComponent({
  props: { items: { type: Array, required: true } },
  emits: ['select'],
  setup(props, { emit }) {
    return () =>
      h('div', { class: 'opportunity-table-wrap' }, [
        h('table', { class: 'opportunity-table' }, [
          h('thead', [
            h(
              'tr',
              ['企业 / 岗位', '工作地点', '月薪区间', '条件核实', '当前状态', ''].map((t) =>
                h('th', t)
              )
            )
          ]),
          h(
            'tbody',
            (props.items as DashboardOpportunity[]).map((o) =>
              h('tr', { key: o.id }, [
                h('td', [h('b', o.job.companyName), h('small', o.job.jobName)]),
                h('td', [
                  h('span', o.district),
                  h(
                    'small',
                    o.lng ? '手动标注位置' : o.district === '地址待补充' ? '待完善' : '行政区定位'
                  )
                ]),
                h(
                  'td',
                  { class: 'salary-cell' },
                  o.job.salaryLow && o.job.salaryHigh
                    ? `${o.job.salaryLow}–${o.job.salaryHigh}K`
                    : '待核实'
                ),
                h('td', [
                  h(
                    'span',
                    { class: 'condition-label' },
                    assessCareerJob(o.job, state.value.profile).questions.length
                      ? '有条件待核实'
                      : '已知条件已初筛'
                  ),
                  h('small', '查看经历依据 →')
                ]),
                h('td', [
                  h(
                    'span',
                    {
                      class: 'stage-pill',
                      style: {
                        color: stageColors[o.stage],
                        background: stageColors[o.stage] + '14'
                      }
                    },
                    [h('i', { style: { background: stageColors[o.stage] } }), o.stage]
                  )
                ]),
                h('td', [
                  h(
                    'button',
                    {
                      class: 'table-detail',
                      onClick: () => emit('select', o),
                      'aria-label': `查看 ${o.job.companyName}`
                    },
                    '详情 ↗'
                  )
                ])
              ])
            )
          )
        ])
      ])
  }
})
function clearFilters() {
  search.value = ''
  stage.value = ''
  district.value = ''
  city.value = ''
  period.value = '0'
}
function applyReplies(data: any) {
  replies.value = data.replies || []
  heartbeat.value = data.heartbeat || {}
  commands.value = data.pendingCommands || {}
  replyTotal.value = data.replyTotal ?? replies.value.length
  for (const r of replies.value)
    if (replyDrafts.value[r.id] === undefined) replyDrafts.value[r.id] = r.draft || ''
  for (const id of Object.keys(replyDrafts.value))
    if (!replies.value.some((r) => r.id === id && ['review', 'blocked'].includes(r.status)))
      delete replyDrafts.value[id]
  if (data.replySettings) {
    policySnapshot.value = data.replySettings
    if (!settingsDirty.value) {
      replySettings.value = { ...data.replySettings }
      savedSettings.value = JSON.stringify(data.replySettings)
      settingsRevision.value = data.settingsRevision
    }
  }
}
let lastOpportunityRequest = ''
function openRequestedOpportunity() {
  const id = String(route.query.opportunity || '')
  if (!id || lastOpportunityRequest === id || editing.value) return
  const item = all.value.find((o) => o.id === id)
  if (item) {
    lastOpportunityRequest = id
    editOpportunity(item)
    detailTab.value = ['job', 'analysis', 'greeting', 'history', 'progress'].includes(
      String(route.query.section)
    )
      ? String(route.query.section)
      : 'job'
  }
}
watch(
  () => route.query.opportunity,
  () => {
    lastOpportunityRequest = ''
    void load(true)
  }
)
let cityInitialized = false
let refreshing = false
async function load(background = false) {
  if (refreshing) return
  refreshing = true
  if (!background) loading.value = true
  try {
    const d = await electron.ipcRenderer.invoke('career-dashboard-load')
    opportunityStates.value = d.opportunityStates || {}
    contactOutcomes.value = d.contactOutcomes || {}
    state.value = d.workspace
    if (!cityInitialized) { city.value = defaultMapCity(state.value.profile.preferredCities); cityInitialized = true }
    revision.value = d.revision
    preferences.value = d.preferences
    records.value = d.records || { applications: [] }
    model.value = d.model || null
    connection.value = d.connection || null
    syncCoverage.value = d.syncCoverage || null
    profileVersion.value = d.profileVersion || ''
    applyReplies(d)
    openRequestedOpportunity()
    error.value = ''
    now.value = Date.now()
    loadedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    if (records.value.truncated) notice.value = '当前展示最近 5000 个已去重机会'
  } catch (e) {
    error.value = `数据读取失败，已有内容与修改已保留：${String(e)}`
  } finally {
    refreshing = false
    loading.value = false
  }
}
function editOpportunity(o: DashboardOpportunity) {
  detailTab.value = 'job'
  editing.value = o
  editForm.value = {
    stage: o.stage,
    endReason: o.endReason || '',
    address: o.job.address || '',
    nextDate: o.nextDate || '',
    note: o.note || '',
    lng: o.lng ?? '',
    lat: o.lat ?? '',
    crs: o.crs || 'unknown',
    commuteMinutes: o.commuteMinutes ?? ''
  }
  editError.value = ''
  editBaseline.value = JSON.stringify(editForm.value)
  editingRevision.value = revision.value
}
const syncResults = ref<InstanceType<typeof BossSyncResults>>()
async function refreshSync() {
  await load(true)
  await syncResults.value?.refresh()
}
function openSyncedConversation(id: string) {
  void router.push({ path: route.path, query: { view: 'replies', conversation: id } })
}
function openSyncedOpportunity(id: string) {
  const item = all.value.find((o) => o.job.encryptJobId === id)
  if (item) editOpportunity(item)
  else notice.value = '岗位信息已更新，请先点击更新本地记录后查看'
}
async function saveOpportunity() {
  if (!editing.value || saving.value) return false
  saving.value = true
  editError.value = ''
  try {
    if (progressEditor.value?.hasDraft && !(await progressEditor.value.save())) return false
    if (intelligenceEditor.value?.hasDraft && !(await intelligenceEditor.value.save())) return false
    const v = editForm.value
    const o = {
      stage: v.stage,
      endReason: v.endReason,
      crs: v.crs,
      commuteMinutes: v.commuteMinutes === '' ? null : Number(v.commuteMinutes),
      address: v.address,
      nextDate: v.nextDate,
      note: v.note,
      updatedAt: new Date().toISOString(),
      ...(v.lng !== '' || v.lat !== ''
        ? { lng: v.lng !== '' ? Number(v.lng) : null, lat: v.lat !== '' ? Number(v.lat) : null }
        : {})
    }
    const next = await electron.ipcRenderer.invoke('career-opportunity-save', {
      id: editing.value.id,
      override: o,
      baseRevision: editingRevision.value
    })
    preferences.value = next.preferences
    revision.value = next.revision
    editing.value = null
    notice.value = '进展已保存，地图和统计已更新'
    return true
  } catch (e) {
    editError.value = String(e)
    return false
  } finally {
    saving.value = false
  }
}
async function saveReplySettings() {
  if (savingPolicy.value || !savedSettings.value) return false
  savingPolicy.value = true
  policyError.value = ''
  try {
    validateReplySettings(replySettings.value)
    const payload = JSON.stringify(replySettings.value)
    const result = await electron.ipcRenderer.invoke('career-reply-settings-save', {
      settings: payload,
      baseRevision: settingsRevision.value
    })
    settingsRevision.value = result.revision
    savedSettings.value = JSON.stringify(result.settings)
    policySnapshot.value = result.settings
    if (JSON.stringify(replySettings.value) === payload)
      replySettings.value = { ...result.settings }
    notice.value =
      '回复策略已保存。' +
      (connected.value ? '助手将在下一次检查时应用新策略。' : '连接桌面消息页后生效。')
    return true
  } catch (e) {
    policyError.value = String(e)
    return false
  } finally {
    savingPolicy.value = false
  }
}
async function reloadPolicy() {
  try {
    await ElMessageBox.confirm('放弃未保存的策略修改，读取当前已生效的配置。', '读取回复策略', {
      confirmButtonText: '重新读取',
      cancelButtonText: '保留修改'
    })
    const d = await electron.ipcRenderer.invoke('career-reply-status')
    replySettings.value = { ...d.replySettings }
    savedSettings.value = JSON.stringify(d.replySettings)
    settingsRevision.value = d.settingsRevision
    policySnapshot.value = d.replySettings
    policyError.value = ''
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') policyError.value = '读取失败，当前策略编辑仍保留。'
  }
}
async function pauseReplies() {
  if (savingPolicy.value) return
  const wasDirty = settingsDirty.value
  savingPolicy.value = true
  try {
    const result = await electron.ipcRenderer.invoke('career-reply-pause')
    policySnapshot.value = result.settings
    savedSettings.value = JSON.stringify(result.settings)
    settingsRevision.value = result.revision
    if (!wasDirty) replySettings.value = { ...result.settings }
    notice.value =
      '回复助手已暂停，尚未发送的队列保留。' +
      (wasDirty ? '当前策略草稿未丢失，保存草稿可能再次启用助手。' : '')
  } catch (e) {
    policyError.value = String(e)
  } finally {
    savingPolicy.value = false
  }
}
async function replyCommand(r: ReplyEvent, action: string) {
  if (commandBusy.value[r.id]) return
  const text = (replyDrafts.value[r.id] || '').trim()
  if (action === 'approve') {
    try {
      await ElMessageBox.confirm(
        `收件人：${r.company || '企业待核实'} / ${r.person || '招聘方'}\n\n回复内容：\n${text}\n\n${connected.value && policySnapshot.value.mode !== 'off' ? '核对最新会话后发送。' : '当前无法立即发送，确认后将排队等待。'}`,
        '确认这一条回复',
        {
          confirmButtonText: '确认此内容',
          cancelButtonText: '继续编辑',
          closeOnClickModal: false,
          customClass: 'atlas-reply-confirm'
        }
      )
    } catch {
      return
    }
  }
  commandBusy.value[r.id] = true
  try {
    await electron.ipcRenderer.invoke('career-reply-command', { id: r.id, action, text })
    applyReplies(await electron.ipcRenderer.invoke('career-reply-status'))
    notice.value =
      action === 'approve'
        ? '已确认并持久保存，等待消息页核对后发送。'
        : '此条回复已取消，不再发送。'
  } catch (e) {
    error.value = String(e)
  } finally {
    delete commandBusy.value[r.id]
  }
}
async function resolveReply(r: ReplyEvent, result: string) {
  try {
    await ElMessageBox.confirm(
      `请先在 BOSS 核对 ${r.company || r.person || '招聘方'} 的会话。\n\n本次内容：${r.draft || '详见会话记录'}\n\n记录为：${result === 'sent' ? '已发送' : result === 'not-sent' ? '未发送，不自动重试' : '仍不确定'}`,
      '核实发送结果',
      { confirmButtonText: '确认核实结果', cancelButtonText: '返回' }
    )
    await electron.ipcRenderer.invoke('career-reply-resolve', { id: r.id, result })
    applyReplies(await electron.ipcRenderer.invoke('career-reply-status'))
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') error.value = String(e)
  }
}
async function closeOpportunity() {
  if (saving.value) return
  if (opportunityDirty.value) {
    try {
      await ElMessageBox.confirm('关闭将放弃本次尚未保存的进展修改。', '进展尚未保存', {
        confirmButtonText: '放弃本次修改',
        cancelButtonText: '继续编辑',
        type: 'warning'
      })
    } catch {
      return
    }
  }
  editing.value = null
}
async function beforeCloseOpportunity(done: () => void) {
  await closeOpportunity()
  if (!editing.value) done()
}
function formatTime(at: string) {
  return new Date(at).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
useDraftProtection(
  computed(() => settingsDirty.value || opportunityDirty.value),
  async () => {
    if (opportunityDirty.value && !(await saveOpportunity())) return false
    return !settingsDirty.value || (await saveReplySettings())
  },
  '回复策略或跟进进展'
)
function replyStatusLabel(r: ReplyEvent) {
  if (commands.value[r.id]) return '已确认 · 待发送'
  return {
    review: '待确认',
    queued: '已排队 · 尚未发送',
    sending: '正在发送',
    sent: '已发送',
    dismissed: '已忽略',
    uncertain: '需核实',
    blocked: '需重新确认'
  }[r.status]
}
function openWorkspace(tab: 'match' | 'profile') {
  router.push({ path: '/main-layout/CareerWorkspace', query: { tab } })
}
async function openChat() {
  if (runtime === 'web') {
    notice.value =
      '请在职途 Atlas 桌面程序点击「打开 BOSS」，登录后进入消息页。网页与桌面共用本机资料，已加载会话会同步到这里。'
    return
  }
  try {
    await electron.ipcRenderer.invoke('atlas-open-boss', {
      url: 'https://www.zhipin.com/web/geek/chat'
    })
    notice.value = '正在窗口内打开 BOSS 工作台'
  } catch (e) {
    error.value = `无法打开消息页：${String(e)}`
  }
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else
    screen.value?.requestFullscreen().catch(() => {
      notice.value = '可使用窗口最大化查看大屏'
    })
}
let timer: ReturnType<typeof setInterval> | undefined,
  active = true
function stopPolling() {
  clearInterval(timer)
  timer = undefined
}
function startPolling() {
  stopPolling()
  if (!active || document.hidden) return
  timer = setInterval(async () => {
    if (document.hidden) return
    now.value = Date.now()
    if (!editing.value) await load(true)
    else {
      try {
        applyReplies(await electron.ipcRenderer.invoke('career-reply-status'))
      } catch {
        /* Preserve drafts during a temporary disconnect. */
      }
    }
  }, 15000)
}
function protectReplyDrafts(event: BeforeUnloadEvent) {
  if (
    replies.value.some(
      (r) =>
        ['review', 'blocked'].includes(r.status) &&
        !commands.value[r.id] &&
        !!replyDrafts.value[r.id]?.trim() &&
        replyDrafts.value[r.id] !== r.draft
    )
  ) {
    event.preventDefault()
    event.returnValue = ''
  }
}
watch(
  replyDrafts,
  (value) => {
    try {
      sessionStorage.setItem('atlas-reply-drafts', JSON.stringify(value))
    } catch {
      /* Draft remains in memory. */
    }
  },
  { deep: true }
)
function visibilityChanged() {
  if (document.hidden) stopPolling()
  else if (active) {
    load(true)
    startPolling()
  }
}
watch(city, () => { district.value = '' })
watch([search, stage, city, district, period, sortBy], () => {
  opportunityPage.value = 1
  try {
    sessionStorage.setItem(
      'atlas-opportunity-filters',
      JSON.stringify({
        search: search.value,
        stage: stage.value,
        city: city.value,
        mapCityVersion: 1,
        district: district.value,
        period: period.value,
        sortBy: sortBy.value
      })
    )
  } catch {
    /* Filtering remains usable without storage. */
  }
})
watch(view, () => {
  notice.value = ''
  screen.value?.scrollTo({ top: 0 })
})
watch([replyFilter, replySearch, replyBoss], () => {
  replyPage.value = 1
})
onMounted(() => {
  try {
    const v = JSON.parse(sessionStorage.getItem('atlas-opportunity-filters') || '{}')
    if (typeof v.search === 'string') search.value = v.search
    if (pipelineStages.includes(v.stage)) stage.value = v.stage
    if (v.mapCityVersion === 1 && typeof v.city === 'string') { city.value = v.city; cityInitialized = true }
    if (typeof v.district === 'string' && v.district !== '上海以外') district.value = v.district
    if (['0', '7', '30'].includes(v.period)) period.value = v.period
    if (['match', 'recent', 'followup'].includes(v.sortBy)) sortBy.value = v.sortBy
  } catch {
    /* Ignore invalid cached filters. */
  }
  try {
    const drafts = JSON.parse(sessionStorage.getItem('atlas-reply-drafts') || '{}')
    if (drafts && typeof drafts === 'object')
      replyDrafts.value = Object.fromEntries(
        Object.entries(drafts).filter(
          ([id, text]) =>
            /^[a-f0-9]{64}$/.test(id) && typeof text === 'string' && text.length <= 1500
        )
      ) as Record<string, string>
  } catch {
    /* Ignore invalid saved drafts. */
  }
  load()
  startPolling()
  document.addEventListener('visibilitychange', visibilityChanged)
  window.addEventListener('beforeunload', protectReplyDrafts)
})
onActivated(() => {
  active = true
  if (loadedAt.value) load(true)
  startPolling()
})
onDeactivated(() => {
  active = false
  stopPolling()
})
onBeforeUnmount(() => {
  stopPolling()
  document.removeEventListener('visibilitychange', visibilityChanged)
  window.removeEventListener('beforeunload', protectReplyDrafts)
})
</script>
<style src="./career-dashboard.css">
.overview-analysis-link { margin:0 0 18px; font-size:13px; color:var(--el-text-color-secondary); } .overview-analysis-link a { display:flex;justify-content:space-between;padding:14px 18px;border:1px solid var(--el-border-color-light);border-radius:8px;background:var(--atlas-panel); } .overview-analysis-link span { color:var(--el-color-primary); }
</style>
