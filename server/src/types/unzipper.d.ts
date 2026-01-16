declare module 'unzipper' {
    import { Stream, Transform } from 'stream';

    export interface Entry extends Transform {
        path: string;
        type: 'Directory' | 'File';
        autodrain: () => void;
    }

    export function Parse(): Transform & {
        on(event: 'entry', listener: (entry: Entry) => void): Transform;
        on(event: 'finish', listener: () => void): Transform;
        on(event: 'error', listener: (err: Error) => void): Transform;
    };

    export function Extract(options?: { path: string }): Transform;
}
