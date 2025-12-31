#!/usr/bin/env python3
import sys
import time
import helper


class SessionNotValidError(Exception):
    pass


def wait_for_process(
    process_name: str,
    existing_pids: set[str],
    session_id: str,
):
    """
    Waits for a new process with the specified name to start and attaches the debugger to it.

    :param process_name: Name of the process to wait for.
    :param existing_pids: List of existing process IDs
    :param session_id: debug session identifier
    """

    check_debug_session_last_time = time.time()
    while True:
        if check_debug_session_last_time + 1.5 < time.time():
            if not helper.is_debug_session_valid(session_id):
                raise SessionNotValidError("Debug session is no longer valid.")
            check_debug_session_last_time = time.time()

        new_pids = [
            x for x in helper.get_list_of_pids(process_name) if x not in existing_pids
        ]

        if len(new_pids) > 0:
            pid = new_pids.pop()
            process = helper.get_process_by_pid(pid)

            # process attach command sometimes fails to stop the process, so we try to do it manually before attaching
            # if we can not do it either way, process would be detached from debugger silently and all status of tests would be lost
            process.suspend()

            return pid

        time.sleep(0.001)


session_id = sys.argv[1]
process_name = sys.argv[2].removesuffix("._exe")
existing_pids = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else set()

result_pid = wait_for_process(process_name, existing_pids, session_id)
print(result_pid)
sys.stdout.flush()
