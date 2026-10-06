import { APP_NAME } from '@studio/shared';
import { Button, Icon, IconButton, TextField } from '@studio/ui';
import { useEffect, useRef, useState } from 'react';
import { DeviceSelect } from './dialogs';
import type { JoinOptions } from './useStudioRoom';

interface Props {
  title: string;
  /** Guests type their name; the host's comes from their account. */
  askName: boolean;
  busy: boolean;
  onJoin(options: JoinOptions, name: string): void;
}

/** Camera and microphone check before entering the studio. Nothing is sent anywhere yet. */
export function GreenRoom({ title, askName, busy, onJoin }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState(() => localStorage.getItem('guest-name') ?? '');
  const [camera, setCamera] = useState(true);
  const [mic, setMic] = useState(true);
  const [cameraId, setCameraId] = useState('');
  const [micId, setMicId] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [granted, setGranted] = useState(false);

  // True once the browser has answered the device request, either way. Joining before that would
  // make the studio open the camera while this preview is still opening it, and one of them loses.
  const [settled, setSettled] = useState(false);
  const preview = useRef<MediaStream | null>(null);

  const releasePreview = () => {
    preview.current?.getTracks().forEach((t) => t.stop());
    preview.current = null;
  };

  useEffect(() => {
    if (!camera && !mic) {
      setSettled(true);
      return;
    }
    let cancelled = false;
    setSettled(false);
    navigator.mediaDevices
      ?.getUserMedia({
        video: camera ? (cameraId ? { deviceId: { exact: cameraId } } : true) : false,
        audio: mic ? (micId ? { deviceId: { exact: micId } } : true) : false,
      })
      .then(
        (media) => {
          if (cancelled) return media.getTracks().forEach((t) => t.stop());
          preview.current = media;
          setBlocked(false);
          setGranted(true);
          if (videoRef.current) videoRef.current.srcObject = camera ? media : null;
        },
        () => !cancelled && setBlocked(true),
      )
      .finally(() => !cancelled && setSettled(true));
    return () => {
      cancelled = true;
      releasePreview();
    };
  }, [camera, mic, cameraId, micId]);

  const join = () => {
    releasePreview();
    if (askName) localStorage.setItem('guest-name', name.trim());
    onJoin({ camera: camera && !blocked, mic: mic && !blocked, cameraId: cameraId || undefined, micId: micId || undefined }, name.trim());
  };
  const canJoin = !busy && settled && (!askName || name.trim().length > 0);

  return (
    <main className="green-room">
      <div className="green-room-preview">
        {camera && !blocked ? (
          <video ref={videoRef} autoPlay muted playsInline />
        ) : (
          <div className="center muted col" style={{ height: '100%' }}>
            <Icon name="videocam_off" style={{ '--md-icon-size': '48px' } as React.CSSProperties} />
            <span className="body-large">{blocked ? 'Camera and microphone are blocked' : 'Camera is off'}</span>
          </div>
        )}
        <div className="green-room-toggles">
          <IconButton
            icon={mic ? 'mic' : 'mic_off'}
            label={mic ? 'Turn microphone off' : 'Turn microphone on'}
            variant={mic ? 'tonal' : 'filled'}
            onClick={() => setMic(!mic)}
          />
          <IconButton
            icon={camera ? 'videocam' : 'videocam_off'}
            label={camera ? 'Turn camera off' : 'Turn camera on'}
            variant={camera ? 'tonal' : 'filled'}
            onClick={() => setCamera(!camera)}
          />
        </div>
      </div>

      <div className="col green-room-form">
        <span className="label-large muted">{APP_NAME}</span>
        <h1 className="headline">{title}</h1>
        <p className="body-large muted">
          {askName
            ? 'Check your camera and microphone. You will wait backstage until the host brings you on.'
            : 'Check your camera and microphone, then enter your studio.'}
        </p>
        {blocked && (
          <p className="body-medium" style={{ color: 'var(--md-sys-color-error)' }}>
            Allow camera and microphone access in your browser's address bar, or join without them.
          </p>
        )}
        {askName && (
          <TextField label="Your name" value={name} onValue={setName} maxLength={40} autoFocus onEnter={() => canJoin && join()} data-testid="guest-name" />
        )}
        {granted && (
          <>
            <DeviceSelect kind="videoinput" label="Camera" value={cameraId} onValue={setCameraId} refreshKey={granted} />
            <DeviceSelect kind="audioinput" label="Microphone" value={micId} onValue={setMicId} refreshKey={granted} />
          </>
        )}
        <div>
          <Button icon="login" onClick={join} disabled={!canJoin} data-testid="enter-studio">
            {askName ? 'Join studio' : 'Enter studio'}
          </Button>
        </div>
      </div>
    </main>
  );
}
