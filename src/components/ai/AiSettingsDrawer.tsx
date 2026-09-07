import { useState } from "react";
import { Check, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import type { AiSettings, ModelConnectionResult, ModelProfile } from "../../ai/types";
import { IconButton } from "../IconButton";
import { ModelProfileForm } from "./ModelProfileForm";

interface AiSettingsDrawerProps {
  open: boolean;
  settings: AiSettings;
  secretProfileIds: Set<string>;
  onClose: () => void;
  onSave: (profile: ModelProfile, apiKey?: string) => Promise<void>;
  onTest: (profile: ModelProfile, apiKey?: string) => Promise<ModelConnectionResult>;
  onSetActive: (profileId: string) => void;
  onDelete: (profileId: string) => void;
}

export function AiSettingsDrawer(props: AiSettingsDrawerProps) {
  const [editing, setEditing] = useState<ModelProfile | "new" | null>(null);
  if (!props.open) return null;

  const finishSave = async (profile: ModelProfile, apiKey?: string) => {
    await props.onSave(profile, apiKey);
    setEditing(null);
  };

  return (
    <div className="drawer-backdrop" onMouseDown={props.onClose}>
      <aside
        className="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="AI 模型设置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div><span className="eyebrow">连接管理</span><h2>AI 模型设置</h2></div>
          <IconButton label="关闭 AI 模型设置" onClick={props.onClose}><X size={18} /></IconButton>
        </header>

        {editing ? (
          <div className="drawer-form-body">
            <h3>{editing === "new" ? "添加模型" : `编辑 ${editing.name}`}</h3>
            <ModelProfileForm
              initialProfile={editing === "new" ? undefined : editing}
              hasStoredKey={editing !== "new" && props.secretProfileIds.has(editing.id)}
              onTest={props.onTest}
              onSubmit={finishSave}
              onCancel={() => setEditing(null)}
            />
          </div>
        ) : (
          <div className="drawer-content">
            <div className="drawer-section-heading">
              <div><h3>模型配置</h3><p>可保存多个 OpenAI 兼容连接，并指定当前模型。</p></div>
              <button type="button" className="button button-primary button-small" aria-label="添加模型" onClick={() => setEditing("new")}>
                <Plus size={15} />添加
              </button>
            </div>
            {props.settings.profiles.length === 0 ? (
              <div className="model-empty"><KeyRound size={24} /><strong>尚未配置模型</strong></div>
            ) : (
              <div className="model-profile-list">
                {props.settings.profiles.map((profile) => {
                  const active = props.settings.activeProfileId === profile.id;
                  return (
                    <article className={`model-profile-item ${active ? "is-active" : ""}`} key={profile.id}>
                      <button
                        type="button"
                        className="model-profile-select"
                        aria-label={`使用 ${profile.name}`}
                        onClick={() => props.onSetActive(profile.id)}
                      >
                        <span className="model-radio">{active && <Check size={13} />}</span>
                        <span><strong>{profile.name}</strong><small>{profile.model} · {new URL(profile.baseUrl).host}</small></span>
                      </button>
                      {active && <span className="active-model-badge">当前使用</span>}
                      <div className="model-profile-actions">
                        <IconButton label={`编辑 ${profile.name}`} onClick={() => setEditing(profile)}><Pencil size={15} /></IconButton>
                        <IconButton label={`删除 ${profile.name}`} tone="danger" onClick={() => props.onDelete(profile.id)}><Trash2 size={15} /></IconButton>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
