from flask import Flask, request, render_template, redirect, url_for, send_file, Response
import os
import zipfile
import difflib
import json
import numpy as np
import re
from werkzeug.utils import secure_filename
from pygments import highlight
from pygments.lexers import PythonLexer
from pygments.formatters import HtmlFormatter
from datetime import datetime, timedelta

def extract_nested_zip(zip_path, extract_to):
    """Recursively extract nested zip files"""
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_to)
    
    zip_ref.close()
    os.remove(zip_path)
    
    for root, _, files in os.walk(extract_to):
        for file in files:
            file_path = os.path.join(root, file)
            if zipfile.is_zipfile(file_path):
                extract_folder = os.path.join(root, file.split('.')[0])
                os.makedirs(extract_folder, exist_ok=True)
                extract_nested_zip(file_path, extract_folder)

'''def get_sorted_folder_items(folder_path):
    history_count = {}  # Number of log entries per student/file
    folder_items = []
    entries_json_present = False
    time_elapsed_dict = {}
    avg_code_lenght_dict = {}
    length_in_char_dict = {}

    # Check if file-logger-audit.log exists at the current level
    log_path = os.path.join(folder_path, 'file-logger-audit.log')
    if os.path.exists(log_path):
        try:
            with open(log_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                entries_list = [json.loads(line.strip()) for line in lines if line.strip()]
                folder_items = [entry['file'] for entry in entries_list if entry.get('file')]
                history_count["CURRENT"] = len(entries_list)
                entries_json_present = True

                # Calculate time elapsed
                timestamps = [datetime.fromisoformat(e['dt'].replace('Z', '')) for e in entries_list if 'dt' in e]
                if len(timestamps) >= 2:
                    time_elapsed_dict["CURRENT"] = str(timestamps[-1] - timestamps[0])
                else:
                    time_elapsed_dict["CURRENT"] = "0:00:00"

                # Track file length changes (chars)
                char_lengths = [e.get('chars') for e in entries_list if e.get('chars') is not None]
                length_in_char_dict["CURRENT"] = char_lengths

                if len(char_lengths) > 1:
                    diffs = [char_lengths[i] - char_lengths[i - 1] for i in range(1, len(char_lengths))]
                    avg_code_lenght_dict["CURRENT"] = sum(diffs) / len(diffs)
                else:
                    avg_code_lenght_dict["CURRENT"] = 0

        except Exception as e:
            print(f"Error parsing log at top level: {e}")
            history_count["CURRENT"] = 0

    # Check all items in directory
    actual_files = sorted(os.listdir(folder_path))
    for item in actual_files:
        if item not in folder_items:
            folder_items.append(item)

    # Search subdirectories for their own logs
    for item in folder_items:
        item_path = os.path.join(folder_path, item).replace('\\', '/')
        item_log_path = ''

        for dirpath, dirnames, filenames in os.walk(item_path):
            if 'file-logger-audit.log' in filenames:
                item_log_path = os.path.join(dirpath, 'file-logger-audit.log')
                break

        if os.path.isdir(item_path) and os.path.exists(item_log_path):
            try:
                with open(item_log_path, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                    entries_list = [json.loads(line.strip()) for line in lines if line.strip()]
                    history_count[item] = len(entries_list)

                    timestamps = [datetime.fromisoformat(e['dt'].replace('Z', '')) for e in entries_list if 'dt' in e]
                    if len(timestamps) >= 2:
                        time_elapsed_dict[item] = str(timestamps[-1] - timestamps[0])
                    else:
                        time_elapsed_dict[item] = "0:00:00"

                    char_lengths = [e.get('chars') for e in entries_list if e.get('chars') is not None]
                    length_in_char_dict[item] = char_lengths

                    if len(char_lengths) > 1:
                        diffs = [char_lengths[i] - char_lengths[i - 1] for i in range(1, len(char_lengths))]
                        avg_code_lenght_dict[item] = sum(diffs) / len(diffs)
                    else:
                        avg_code_lenght_dict[item] = 0

            except Exception as e:
                print(f"Error parsing log for {item}: {e}")
                history_count[item] = 0
        else:
            history_count[item] = 0

    return folder_items, entries_json_present, history_count, time_elapsed_dict, avg_code_lenght_dict'''

def compute_metrics_from_log(log_path):
    metrics = {}
    try:
        with open(log_path, 'r', encoding='utf-8') as f:
            lines = [line.strip() for line in f if line.strip()]
            entries = [json.loads(line) for line in lines]
        if not entries:
            return {}

        entries = sorted(entries, key=lambda x: x.get('dt', ''))
        timestamps = [datetime.fromisoformat(e['dt'].replace('Z','')) for e in entries if 'dt' in e]
        chars_list = [e.get('chars', 0) for e in entries if e.get('chars') is not None]
        files = [e.get('file') for e in entries if e.get('file')]
        distinct_files = set(files)

        metrics['edit_count'] = len(entries)
        metrics['first_edit'] = str(timestamps[0]) if timestamps else ""
        metrics['last_edit'] = str(timestamps[-1]) if timestamps else ""
        metrics['time_elapsed'] = str(timestamps[-1] - timestamps[0]) if len(timestamps) >= 2 else "0:00:00"
        metrics['edit_frequency_per_hour'] = round(metrics['edit_count'] / max((timestamps[-1] - timestamps[0]).total_seconds() / 3600, 1), 2) if len(timestamps) >= 2 else metrics['edit_count']
        metrics['distinct_files_edited'] = len(distinct_files)
        metrics['net_code_growth'] = chars_list[-1] - chars_list[0] if len(chars_list) >= 2 else 0
        metrics['max_code_size'] = max(chars_list) if chars_list else 0
        metrics['min_code_size'] = min(chars_list) if chars_list else 0
        metrics['stddev_code_size'] = float(np.std(chars_list)) if chars_list else 0

        diffs = [chars_list[i] - chars_list[i - 1] for i in range(1, len(chars_list))]
        abs_diffs = [abs(d) for d in diffs]
        metrics['avg_code_diff'] = round(np.mean(diffs), 2) if diffs else 0
        metrics['largest_single_change'] = max(abs_diffs) if abs_diffs else 0

        idle_gaps = [(timestamps[i] - timestamps[i - 1]).total_seconds() for i in range(1, len(timestamps))]
        if idle_gaps:
            max_idle_seconds = max(idle_gaps)
            metrics['longest_idle_gap'] = str(timedelta(seconds=max_idle_seconds))
        else:
            metrics['longest_idle_gap'] = "0:00:00"

        # Session count (new session if >30min gap)
        session_threshold = 30 * 60  # 30 minutes
        sessions = 1 if timestamps else 0
        for gap in idle_gaps:
            if gap > session_threshold:
                sessions += 1
        metrics['session_count'] = sessions

    except Exception as e:
        print(f"Error processing log: {e}")
        return {}
    return metrics

def is_class_folder(folder_path):
    items = os.listdir(folder_path)
    # Only keep directories
    subfolders = [f for f in items if os.path.isdir(os.path.join(folder_path, f))]
    # If there's any file, not a class folder
    if len(subfolders) != len(items) or not subfolders:
        return False
    # Student naming convention (customize as needed)
    student_pattern = re.compile(r'.+_\d+_assignsubmission_file')
    matches = [sf for sf in subfolders if student_pattern.fullmatch(sf)]
    # Consider class folder if a high percentage (say, >50%) match
    return len(matches) >= max(1, len(subfolders) // 2)

def find_log_file(student_folder_path):
    for root, dirs, files in os.walk(student_folder_path):
        if 'file-logger-audit.log' in files:
            return os.path.join(root, 'file-logger-audit.log')
    return None

def get_sorted_folder_items(folder_path):
    folder_items = []
    metrics_dict = {}

    subfolders = [f for f in os.listdir(folder_path) if os.path.isdir(os.path.join(folder_path, f))]

    if is_class_folder(folder_path):
        for sf in subfolders:
            student_folder_path = os.path.join(folder_path, sf)
            log_path = find_log_file(student_folder_path)
            if log_path:
                metrics = compute_metrics_from_log(log_path)
                if metrics:
                    folder_items.append(sf)
                    metrics_dict[sf] = metrics
    else:
        # Display everything (folders + files) as items under this directory
        all_items = sorted(os.listdir(folder_path))
        for item in all_items:
            item_path = os.path.join(folder_path, item)
            # If it's a folder, try to fetch metrics recursively
            if os.path.isdir(item_path):
                log_path = find_log_file(item_path)
                if log_path:
                    metrics = compute_metrics_from_log(log_path)
                    if metrics:
                        metrics_dict[item] = metrics
                folder_items.append(item)
            else:
                # Just a file: always show
                folder_items.append(item)

    return folder_items, metrics_dict

app = Flask(__name__)
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/')
def index():
    extracted_items = []
    for folder in os.scandir(UPLOAD_FOLDER):
        if folder.is_dir():
            extracted_items.append(folder.name)
    return render_template('index.html', extracted_items=extracted_items)

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return redirect(request.url)
    file = request.files['file']
    if file.filename == '':
        return redirect(request.url)
    
    if file:
        filename = secure_filename(file.filename)
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(file_path)
        
        if zipfile.is_zipfile(file_path):
            extract_folder = os.path.join(UPLOAD_FOLDER, filename.split('.')[0])
            os.makedirs(extract_folder, exist_ok=True)
            extract_nested_zip(file_path, extract_folder)
        
        return redirect(url_for('index'))
    
    return redirect(url_for('index'))

@app.route('/folder/<path:folder_path>', methods=['GET', 'POST'])
def view_folder(folder_path):
    """ View the contents of a folder (now supports all rich metrics per student) """
    full_path = os.path.join(UPLOAD_FOLDER, folder_path).replace('\\', '/')
    parent_path = os.path.dirname(folder_path).replace('\\', '/')

    folder_items = []
    metrics_dict = {}

    if os.path.exists(full_path) and os.path.isdir(full_path):
        folder_items, metrics_dict = get_sorted_folder_items(full_path)

    corrected_folder_items = [
        os.path.join(folder_path, item).replace('\\', '/')
        for item in folder_items
    ]

    return render_template(
        'folder_view.html',
        folder_path=folder_path.replace('\\', '/'),
        parent_path=parent_path if parent_path != "uploads" else "",
        folder_items=corrected_folder_items,
        metrics_dict=metrics_dict
    )


@app.route('/file/<path:file_path>')
def view_file(file_path):
    full_path = os.path.join(UPLOAD_FOLDER, file_path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        if file_path.endswith('.py') or file_path.endswith('.ipynb'):
            with open(full_path, 'r', encoding='utf-8') as f:
                code = f.read()
            formatter = HtmlFormatter(linenos=True, full=True, style="colorful")
            highlighted_code = highlight(code, PythonLexer(), formatter)
            return Response(highlighted_code, mimetype='text/html')
        return send_file(full_path)
    return "File not found", 404

@app.route('/compare', methods=['GET'])
def compare_files():
    file1 = request.args.get('file1')
    file2 = request.args.get('file2')
    file1_path = os.path.join(UPLOAD_FOLDER, file1)
    file2_path = os.path.join(UPLOAD_FOLDER, file2)
    
    if os.path.exists(file1_path) and os.path.exists(file2_path):
        with open(file1_path, 'r', encoding='utf-8') as f1, open(file2_path, 'r', encoding='utf-8') as f2:
            file1_content = f1.readlines()
            file2_content = f2.readlines()
        
        diff = difflib.HtmlDiff().make_table(file1_content, file2_content, file1, file2)
        
        return render_template('diff_view.html', file1=file1, file2=file2, diff=diff)
    
    return "One or both files not found", 404

if __name__ == '__main__':
    app.run(debug=True)
